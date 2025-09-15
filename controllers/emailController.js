// controllers/emailController.js
// controllers/emailController.js
'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fetch, Agent } = require('undici');
const EmailContact = require('../models/email');

const httpAgent = new Agent({
  keepAliveTimeout: (Number(process.env.KEEP_ALIVE_SECONDS || 60)) * 1000,
  keepAliveMaxTimeout: (Number(process.env.KEEP_ALIVE_SECONDS || 60)) * 1000,
});

// ---- Optional fast downscale: `npm i sharp` (recommended) ----
const USE_SHARP = process.env.USE_SHARP !== '0';
let sharp = null;
if (USE_SHARP) {
  try { sharp = require('sharp'); } catch {}
}

// ---- Optional JSON repair: `npm i jsonrepair` ----
let jsonrepairFn = null;
try { jsonrepairFn = require('jsonrepair').jsonrepair || require('jsonrepair'); } catch {}

// ---- Models & perf knobs ----
const MODEL_PRIMARY   = process.env.OPENAI_VISION_MODEL     || process.env.OPENAI_VISION_PRIMARY  || 'gpt-4o-mini';
const MODEL_FALLBACK  = process.env.OPENAI_VISION_FALLBACK  || 'gpt-4o';
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;

const PRIMARY_TOKENS  = Number(process.env.PRIMARY_TOKENS || 320);
const RETRY_TOKENS    = Number(process.env.RETRY_TOKENS   || 900);

const TEMP            = Number(process.env.TEMPERATURE || 0);
const TIMEOUT_MS      = Number(process.env.OPENAI_TIMEOUT_MS || 30000);
const MAX_IMG_W       = Number(process.env.MAX_IMAGE_WIDTH || 1280);
const MAX_IMG_H       = Number(process.env.MAX_IMAGE_HEIGHT || 1280);
const IMAGE_DETAIL    = (process.env.IMAGE_DETAIL || 'low'); // 'low'|'auto' (hint for remote URLs)
const ENABLE_CACHE    = process.env.ENABLE_CACHE !== '0';
const CACHE_TTL_MS    = Number(process.env.CACHE_TTL_MS || 5 * 60_000);
const AGGRESSIVE_RACE = process.env.AGGRESSIVE_RACE === '1';

// ---- Dark-mode enhancement (auto) ----
const ENABLE_DARK_ENHANCE = process.env.ENABLE_DARK_ENHANCE !== '0'; // default ON

// ---------- Regex ----------
const EMAIL_RX       = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const HANDLE_IN_TEXT = /@[A-Za-z0-9._\-]+/g;
const YT_HANDLE_RX   = /\/@([A-Za-z0-9._\-]+)/i;
const IG_RX          = /(?:instagram\.com|ig\.me)\/([A-Za-z0-9._\-]+)/i;
const TW_RX          = /(?:twitter\.com|x\.com)\/([A-Za-z0-9._\-]+)/i;

// ---------- JSON schema (More-info only) ----------
const SECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    emails:  { type: 'array', items: { type: 'string' } },
    handles: { type: 'array', items: { type: 'string' } },
    fields:  {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { key: { type: 'string' }, value: { type: 'string' } },
        required: ['key', 'value']
      }
    },
    raw_text: { type: 'string' }
  },
  required: ['emails', 'handles', 'fields', 'raw_text']
};
const RESPONSE_SCHEMA = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      has_captcha:      { type: 'boolean' },
      rejection_reason: { type: ['string', 'null'] },
      more_info:        SECTION_SCHEMA
    },
    required: ['has_captcha', 'rejection_reason', 'more_info']
  }
};

// ---------- Prompts ----------
const SYSTEM_MSG =
  'You extract text from a screenshot of a YouTube channel “About” popover and return strict JSON. ' +
  'If a visible reCAPTCHA checkbox (“I’m not a robot” with the reCAPTCHA logo) exists: set has_captcha=true and a brief rejection_reason. ' +
  'Otherwise: only include the content under the “More info” heading, in a `more_info` object with emails, handles, fields, raw_text. ' +
  'Return JSON only. In `handles`, include ONLY plain handles that start with "@" (no URLs). Lowercase is fine.';
const USER_INSTRUCTIONS =
  'Return only JSON. If the “More info” section is not present, set `more_info` to empty arrays/strings (no fallback to any other section).';

// ---------- Helpers ----------
function guessMime(p) {
  const ext = (p && path.extname(p).toLowerCase()) || '';
  if (ext === '.png')  return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}
function bufferToDataUrl(buf, mime = 'image/jpeg') {
  const b64 = Buffer.from(buf).toString('base64');
  return `data:${mime};base64,${b64}`;
}
function uniqueSorted(arr = []) {
  const seen = new Set(); const out = [];
  for (const s of arr) {
    const k = (s || '').trim(); if (!k) continue;
    const low = k.toLowerCase(); if (!seen.has(low)) { seen.add(low); out.push(k); }
  }
  return out;
}
function hashString(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function now() { return Date.now(); }

// In-memory cache (store ONLY parse result, never DB outcome)
const CACHE = new Map();
function cacheGet(key) {
  if (!ENABLE_CACHE) return null;
  const v = CACHE.get(key); if (!v) return null;
  if (now() - v.ts > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  return v.data;
}
function cacheSet(key, data) {
  if (!ENABLE_CACHE) return;
  CACHE.set(key, { ts: now(), data });
  if (CACHE.size > 500) { for (const k of CACHE.keys()) { CACHE.delete(k); if (CACHE.size <= 400) break; } }
}

async function enhanceIfDark(buffer) {
  if (!sharp || !ENABLE_DARK_ENHANCE) return buffer;
  try {
    const img = sharp(buffer, { failOn: 'none' });
    const stats = await img.stats();
    const means = stats.channels.slice(0, 3).map(c => c.mean || 0);
    const avg = means.reduce((a,b)=>a+b,0)/(means.length||1);
    if (avg < 85) {
      return await sharp(buffer).modulate({ brightness: 1.35, saturation: 1.08 }).gamma(1.05).toBuffer();
    }
    return buffer;
  } catch { return buffer; }
}
async function preprocessImage(buffer, mime) {
  if (!sharp) return buffer;
  try {
    let img = sharp(buffer, { failOn: 'none' });
    const meta = await img.metadata();
    const w = meta.width || 0, h = meta.height || 0;
    if (w > MAX_IMG_W || h > MAX_IMG_H) {
      img = img.resize({ width: MAX_IMG_W, height: MAX_IMG_H, fit: 'inside', withoutEnlargement: true });
    }
    const buf = await (mime.includes('png') ? img.png({ compressionLevel: 6 }) : img.jpeg({ quality: 80 })).toBuffer();
    return await enhanceIfDark(buf);
  } catch { return await enhanceIfDark(buffer); }
}
async function imagePartFromBuffer(buffer, mimetype) {
  const mime = mimetype || 'image/jpeg';
  const buf  = await preprocessImage(buffer, mime);
  return { type: 'input_image', image_url: bufferToDataUrl(buf, mime) };
}
async function imagePartFromPath(absPath) {
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);
  const mime = guessMime(absPath);
  const buf0 = fs.readFileSync(absPath);
  const buf  = await preprocessImage(buf0, mime);
  return { type: 'input_image', image_url: bufferToDataUrl(buf, mime) };
}
function imagePartFromUrl(url) {
  return { type: 'input_image', image_url: { url: String(url), detail: IMAGE_DETAIL } };
}

// ---------- OpenAI helpers ----------
function extractOutputText(data) {
  if (data?.output && Array.isArray(data.output)) {
    for (const o of data.output) {
      if (!o?.content) continue;
      for (const c of o.content) {
        if (c?.type === 'output_json' && c?.json) return JSON.stringify(c.json);
        if (c?.json) return JSON.stringify(c.json);
        if (c?.type === 'output_text' && typeof c.text === 'string') return c.text;
        if (typeof c?.text === 'string') return c.text;
      }
    }
  }
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  if (Array.isArray(data?.choices)) {
    const content = data.choices[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(p => p?.text || '').join('\n').trim();
  }
  return '';
}
function safeJSONParse(input) {
  if (input && typeof input === 'object') return input;
  if (typeof input !== 'string') throw new Error('Expected JSON string');
  let t = input.trim();
  t = t.replace(/```(?:json)?/gi, '').replace(/```/g, '').replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\u2060]/g, '').trim();
  const first = t.indexOf('{'); const last = t.lastIndexOf('}');
  if (first !== -1 && last !== -1 && first < last) t = t.slice(first, last + 1);
  t = t.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(t); }
  catch {
    if (jsonrepairFn) return JSON.parse(jsonrepairFn(t));
    throw new Error(`Invalid JSON after repair attempts. Preview: ${t.slice(0, 200)}…`);
  }
}
function makeBody(imagePart, model, maxTokens) {
  return {
    model,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: SYSTEM_MSG }] },
      { role: 'user',   content: [{ type: 'input_text', text: USER_INSTRUCTIONS }, imagePart] }
    ],
    text: { format: { type: 'json_schema', name: 'YouTubeAboutExtraction', schema: RESPONSE_SCHEMA.schema, strict: true } },
    temperature: TEMP,
    max_output_tokens: maxTokens
  };
}
async function callOpenAI(body, timeoutMs) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(new Error('OpenAI timeout')), timeoutMs);
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      dispatcher: httpAgent,
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal
    });
    if (!r.ok) { const errText = await r.text().catch(() => ''); throw new Error(`OpenAI ${r.status}: ${errText || r.statusText}`); }
    const data = await r.json();
    const text = extractOutputText(data);
    if (!text) throw new Error('Empty output from OpenAI.');
    return text;
  } finally { clearTimeout(t); }
}
function isValidStructured(result) {
  if (!result || typeof result !== 'object') return false;
  return ['has_captcha', 'rejection_reason', 'more_info'].every(k => k in result);
}
async function tryOnce(imagePart, model, tokens) {
  const txt = await callOpenAI(makeBody(imagePart, model, tokens), TIMEOUT_MS);
  const parsed = safeJSONParse(txt);
  if (!isValidStructured(parsed)) throw new Error('Invalid structured output');
  return parsed;
}
async function callVisionFast(imagePart) {
  if (AGGRESSIVE_RACE) {
    const pPrimary = (async () => { try { return await tryOnce(imagePart, MODEL_PRIMARY, PRIMARY_TOKENS); } catch { return await tryOnce(imagePart, MODEL_PRIMARY, RETRY_TOKENS); } })();
    const pFallback = tryOnce(imagePart, MODEL_FALLBACK, RETRY_TOKENS).catch(() => null);
    const winner = await Promise.any([pPrimary, pFallback].map(p => p.catch(() => Promise.reject())));
    return winner;
  } else {
    try { return await tryOnce(imagePart, MODEL_PRIMARY, PRIMARY_TOKENS); }
    catch { try { return await tryOnce(imagePart, MODEL_PRIMARY, RETRY_TOKENS); }
      catch { return await tryOnce(imagePart, MODEL_FALLBACK, RETRY_TOKENS); } }
  }
}

// ---------- Post-processing & normalization ----------
function extractYouTube(fieldsArray = [], raw = '') {
  for (const kv of fieldsArray) {
    const k = (kv?.key || '').toLowerCase();
    if (k === 'youtube' && typeof kv.value === 'string' && kv.value.trim()) {
      return kv.value.trim();
    }
  }
  const m = raw.match(/(https?:\/\/)?(www\.)?youtube\.com\/@[A-Za-z0-9._\-]+/i);
  return m ? (m[0].replace(/^https?:\/\//i, '').replace(/^www\./i, 'www.')) : null;
}
function firstValidEmail(emailsArr = [], raw = '') {
  const norm = (emailsArr || []).flatMap(s => (String(s || '').match(EMAIL_RX) || []));
  if (norm.length) return norm[0].toLowerCase();
  const fromRaw = (raw || '').match(EMAIL_RX);
  return fromRaw ? fromRaw[0].toLowerCase() : null;
}
function deriveHandleFromMi(mi = {}) {
  for (const h of (mi.handles || [])) {
    const s = String(h || '');
    const m = s.match(HANDLE_IN_TEXT);
    if (m && m[0]) return m[0].toLowerCase();
    const my = s.match(YT_HANDLE_RX);
    if (my && my[1]) return `@${my[1].toLowerCase()}`;
  }
  if (mi.YouTube) {
    const my = String(mi.YouTube).match(YT_HANDLE_RX);
    if (my && my[1]) return `@${my[1].toLowerCase()}`;
  }
  const r = String(mi.raw_text || '').match(HANDLE_IN_TEXT);
  if (r && r[0]) return r[0].toLowerCase();
  const big = [...((mi.fields || []).map(kv => `${kv.key}: ${kv.value}`)), String(mi.raw_text || '')].join('\n');
  let m = big.match(IG_RX); if (m && m[1]) return `@${m[1].toLowerCase()}`;
  m = big.match(TW_RX); if (m && m[1]) return `@${m[1].toLowerCase()}`;
  return null;
}
function shapeForClient(parsed) {
  const has_captcha = !!parsed?.has_captcha;
  const mi = parsed?.more_info || {};
  const cleaned = {
    emails:  uniqueSorted(mi.emails || []),
    handles: uniqueSorted(mi.handles || []),
    YouTube: extractYouTube(mi.fields || [], mi.raw_text || '') || null,
    raw_text: mi.raw_text || '',
    fields: mi.fields || []
  };
  const email  = firstValidEmail(cleaned.emails, cleaned.raw_text);
  const handle = deriveHandleFromMi({ ...cleaned });
  return {
    has_captcha,
    more_info: { emails: cleaned.emails, handles: cleaned.handles, YouTube: cleaned.YouTube },
    normalized: { email, handle }
  };
}

// ---------- Persistence (returns outcome so caller can mark errors) ----------
async function persistMoreInfo(normalized) {
  const email  = normalized?.email  ? normalized.email.toLowerCase().trim()  : null;
  const handle = normalized?.handle ? normalized.handle.toLowerCase().trim() : null;

  if (!email || !handle || !/^@[A-Za-z0-9._\-]+$/.test(handle)) {
    return { outcome: 'invalid', message: 'No valid email or @handle found under more_info.' };
  }

  const [byEmail, byHandle] = await Promise.all([
    EmailContact.findOne({ email }).lean(),
    EmailContact.findOne({ handle }).lean()
  ]);

  if (byEmail && byHandle) {
    if (byEmail._id?.toString() === byHandle._id?.toString()) {
      return { outcome: 'duplicate', message: 'User handle and email are already present in the database.', id: byEmail._id };
    }
    return { outcome: 'duplicate', message: 'Email and handle already exist (in different records).', emailId: byEmail._id, handleId: byHandle._id };
  }
  if (byEmail)  return { outcome: 'duplicate', message: 'Email is already present in the database.', emailId: byEmail._id };
  if (byHandle) return { outcome: 'duplicate', message: 'User handle is already present in the database.', handleId: byHandle._id };

  const doc = await EmailContact.create({ email, handle });
  return { outcome: 'saved', id: doc._id };
}

// ---------- Batch ONLY (up to 5 images) ----------
async function extractEmailsAndHandlesBatch(req, res) {
  try {
    if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

    const tasks = [];

    // 1) multipart files
    const files = Array.isArray(req.files) ? req.files : [];
    const selectedFiles = files.filter(f => /^image\/(png|jpe?g|webp)$/i.test(f.mimetype || '')).slice(0, 5);

    for (const f of selectedFiles) {
      tasks.push((async () => {
        try {
          const imagePart = await imagePartFromBuffer(f.buffer, f.mimetype);
          const cacheKey = hashString(`p|${f.originalname}|${f.size}|${MODEL_PRIMARY}|${MODEL_FALLBACK}|${PRIMARY_TOKENS}|${RETRY_TOKENS}|${IMAGE_DETAIL}|darkenhance`);
          let shaped = cacheGet(cacheKey);
          if (!shaped) {
            const parsed = await callVisionFast(imagePart);
            shaped = shapeForClient(parsed);
            cacheSet(cacheKey, shaped); // cache ONLY parsed shape
          }

          // Captcha → return as error for this screenshot
          if (shaped.has_captcha) {
            return { error: 'Captcha detected. Skipping database save.', has_captcha: true };
          }

          const dbRes = await persistMoreInfo(shaped.normalized);
          if (dbRes.outcome === 'saved') {
            return { has_captcha: false, more_info: shaped.more_info, db: { saved: true, id: dbRes.id } };
          } else {
            // mark this screenshot as error (duplicate/invalid)
            return {
              error: dbRes.message,
              has_captcha: false,
              more_info: shaped.more_info,
              normalized: shaped.normalized,
              details: dbRes
            };
          }
        } catch (e) {
          return { error: e?.message || 'Failed to process this image.' };
        }
      })());
    }

    // 2) JSON: imageUrl(s)
    const urls = Array.isArray(req.body?.imageUrl) ? req.body.imageUrl : (req.body?.imageUrls || []);
    if (Array.isArray(urls)) {
      for (const u of urls.slice(0, Math.max(0, 5 - tasks.length))) {
        tasks.push((async () => {
          try {
            const imagePart = imagePartFromUrl(u);
            const cacheKey = hashString(`purl|${u}|${MODEL_PRIMARY}|${MODEL_FALLBACK}|${PRIMARY_TOKENS}|${RETRY_TOKENS}|${IMAGE_DETAIL}|darkenhance`);
            let shaped = cacheGet(cacheKey);
            if (!shaped) {
              const parsed = await callVisionFast(imagePart);
              shaped = shapeForClient(parsed);
              cacheSet(cacheKey, shaped);
            }
            if (shaped.has_captcha) {
              return { error: 'Captcha detected. Skipping database save.', has_captcha: true };
            }
            const dbRes = await persistMoreInfo(shaped.normalized);
            if (dbRes.outcome === 'saved') {
              return { has_captcha: false, more_info: shaped.more_info, db: { saved: true, id: dbRes.id } };
            } else {
              return { error: dbRes.message, has_captcha: false, more_info: shaped.more_info, normalized: shaped.normalized, details: dbRes };
            }
          } catch (e) {
            return { error: e?.message || 'Failed to process this image URL.' };
          }
        })());
      }
    }

    // 3) JSON: imagePath(s)
    const paths = Array.isArray(req.body?.imagePath) ? req.body.imagePath : (req.body?.imagePaths || []);
    if (Array.isArray(paths)) {
      for (const pth of paths.slice(0, Math.max(0, 5 - tasks.length))) {
        tasks.push((async () => {
          try {
            const imagePart = await imagePartFromPath(path.resolve(String(pth)));
            const cacheKey = hashString(`ppath|${pth}|${MODEL_PRIMARY}|${MODEL_FALLBACK}|${PRIMARY_TOKENS}|${RETRY_TOKENS}|${IMAGE_DETAIL}|darkenhance`);
            let shaped = cacheGet(cacheKey);
            if (!shaped) {
              const parsed = await callVisionFast(imagePart);
              shaped = shapeForClient(parsed);
              cacheSet(cacheKey, shaped);
            }
            if (shaped.has_captcha) {
              return { error: 'Captcha detected. Skipping database save.', has_captcha: true };
            }
            const dbRes = await persistMoreInfo(shaped.normalized);
            if (dbRes.outcome === 'saved') {
              return { has_captcha: false, more_info: shaped.more_info, db: { saved: true, id: dbRes.id } };
            } else {
              return { error: dbRes.message, has_captcha: false, more_info: shaped.more_info, normalized: shaped.normalized, details: dbRes };
            }
          } catch (e) {
            return { error: e?.message || 'Failed to process this image path.' };
          }
        })());
      }
    }

    if (tasks.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Provide up to 5 images via multipart (PNG/JPG/WEBP) or arrays imageUrls/imagePaths.' });
    }

    const results = await Promise.all(tasks);
    return res.json({ results });

  } catch (err) {
    console.error('extractEmailsAndHandlesBatch error:', err);
    return res.status(400).json({ status: 'error', message: err?.message || 'Batch processing failed.' });
  }
}

module.exports = { extractEmailsAndHandlesBatch };



















// // controllers/emailController.js
// // controllers/emailController.js
// const Tesseract = require("tesseract.js");

// /* =========================== Tunables for your case =========================== */
// // Only keep emails from these domains
// const DOMAIN_ALLOWLIST = new Set(["mhdtechproduction.com", "mhdtechpro.com"]);

// // If these tokens appear anywhere in the OCR text, we will confidently add these emails
// const KEYWORD_TO_EMAIL = {
//   promotion: "promotion@mhdtechproduction.com",
//   aria: "aria@mhdtechpro.com",
//   partnership: "partnership@mhdtechpro.com",
// };

// // Only keep handles that look like your brand (prevents noisy @OMwOTh, etc.)
// const HANDLE_MUST_INCLUDE = "mhd"; // e.g., keeps @mhd_tech, @mhd.tech

// /* =========================== Helpers =========================== */

// // Optional image pre-processing (requires: npm i sharp). If not installed, silently skip.
// async function preprocess(buffer) {
//   try {
//     const sharp = require("sharp");
//     return await sharp(buffer)
//       .grayscale()
//       .normalize()
//       .resize({ width: 2000, withoutEnlargement: false })
//       .sharpen()
//       .toBuffer();
//   } catch {
//     return buffer;
//   }
// }

// const uniqLower = (arr) => [...new Set((arr || []).map((s) => s.toLowerCase()))];

// function normalizeForEmails(raw) {
//   return raw
//     .replace(/[·•∙⋅•]/g, ".")            // bullets -> dot
//     .replace(/[＠]/g, "@")                // full-width @
//     .replace(/\u200B|\u200C|\u200D/g, "") // zero-width
//     .replace(/\s*@\s*/g, "@")
//     .replace(/\s*\.\s*/g, ".")
//     .replace(/(\w)\s+\.(\w)/g, "$1.$2")
//     .replace(/(\w)@\s+(\w)/g, "$1@$2");
// }

// // fix common OCR mistakes in domain/tld
// function correctObviousTldTypos(email) {
//   return email
//     .replace(/\.c0m$/i, ".com")
//     .replace(/\.con$/i, ".com")
//     .replace(/\.co\/?$/i, ".com")
//     .replace(/\.tec$/i, ".tech");
// }

// function extractEmailsSmart(text) {
//   const norm = normalizeForEmails(text);

//   // strict first
//   const strictRx = /\b[A-Z][A-Z0-9._%+-]*@[A-Z0-9.-]+\.[A-Z.]{2,}\b/gi;
//   const strict = (norm.match(strictRx) || []).map(correctObviousTldTypos);

//   // fuzzy: spaces / bullets in domain
//   const fuzzyRx =
//     /\b([A-Z][A-Z0-9._%+-]*)\s*[@＠]\s*([A-Z0-9.-]+(?:\s*(?:\.|·|•|∙|⋅)\s*[A-Z0-9.-]+)+)\b/gi;

//   const fuzzy = [];
//   let m;
//   while ((m = fuzzyRx.exec(text)) !== null) {
//     const email = `${m[1]}@${m[2]}`
//       .replace(/\s+/g, "")
//       .replace(/[·•∙⋅•]/g, ".")
//       .replace(/\.+/g, ".");
//     const cleaned = correctObviousTldTypos(email);
//     if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z.]{2,}\b/i.test(cleaned)) {
//       fuzzy.push(cleaned);
//     }
//   }

//   return uniqLower([...strict, ...fuzzy]);
// }

// function filterToAllowedDomains(emails) {
//   return uniqLower(
//     (emails || []).filter((e) => {
//       const parts = e.toLowerCase().split("@");
//       if (parts.length !== 2) return false;
//       const domain = parts[1];
//       return DOMAIN_ALLOWLIST.has(domain);
//     })
//   );
// }

// function augmentFromKeywords(text, currentEmails) {
//   const found = new Set(currentEmails || []);
//   const lower = text.toLowerCase();
//   for (const [kw, email] of Object.entries(KEYWORD_TO_EMAIL)) {
//     if (lower.includes(kw)) found.add(email);
//   }
//   return [...found];
// }

// function extractHandles(text, emails) {
//   const handles = new Set();

//   // youtube.com/@handle
//   const ytRx = /youtube\.com\/@([A-Za-z0-9._-]{2,30})/gi;
//   let m;
//   while ((m = ytRx.exec(text)) !== null) handles.add("@" + m[1]);

//   // standalone @handle not inside an email
//   const standaloneRx = /(^|[^A-Za-z0-9._-])@([A-Za-z0-9._-]{2,30})\b/g;
//   while ((m = standaloneRx.exec(text)) !== null) {
//     const candidate = "@" + m[2];
//     const isInsideEmail = (emails || []).some((e) => e.includes(candidate));
//     if (!isInsideEmail) handles.add(candidate);
//   }

//   // Keep only brand-looking handles (reduce noise)
//   return [...handles].filter((h) => h.toLowerCase().includes(HANDLE_MUST_INCLUDE));
// }

// function extractYouTubeUrl(text, fallbackHandle) {
//   const rx = /(https?:\/\/)?(www\.)?youtube\.com\/@([A-Za-z0-9._-]{2,30})/i;
//   const m = text.match(rx);
//   if (m) return `www.youtube.com/@${m[3]}`;
//   if (fallbackHandle && /^@[A-Za-z0-9._-]{2,30}$/.test(fallbackHandle)) {
//     return `www.youtube.com/${fallbackHandle}`;
//   }
//   return null;
// }

// function splitNormalVsMoreInfo(text) {
//   const idx = text.toLowerCase().indexOf("more info");
//   if (idx === -1) return { normalText: text, moreInfoText: "" };
//   return { normalText: text.slice(0, idx), moreInfoText: text.slice(idx) };
// }

// // Strong CAPTCHA detection: phrases, tokens, "Privacy • Terms"
// function hasCaptcha(text, data) {
//   const rawFlags = [
//     /i['’`"]?\s*m\s*not\s*a\s*robot/i,
//     /\brecaptcha\b/i,
//     /\bcaptcha\b/i,
//     /privacy\s*[-–•]\s*terms/i
//   ];
//   if (rawFlags.some((rx) => rx.test(text))) return true;

//   const flat = text.toLowerCase().replace(/[^a-z]/g, "");
//   if (flat.includes("imnotarobot") || flat.includes("iamnotarobot")) return true;

//   if (data && Array.isArray(data.words)) {
//     const tokens = data.words.map((w) => (w.text || "").toLowerCase());
//     const hasPrivacy = tokens.some((t) => t.startsWith("privacy"));
//     const hasTerms = tokens.some((t) => t.startsWith("terms"));
//     if (tokens.some((t) => t.includes("recaptcha") || t === "captcha") || (hasPrivacy && hasTerms)) {
//       return true;
//     }
//     for (let i = 0; i < tokens.length; i++) {
//       if (tokens[i].includes("robot")) {
//         const win = tokens.slice(Math.max(0, i - 5), i + 6).join(" ");
//         if (/i['’`"]?m\s*not/i.test(win) || /\bi\s*m\s*not/i.test(win)) return true;
//       }
//     }
//   }
//   return false;
// }

// /* =========================== OCR Core =========================== */

// async function ocrOne(buffer) {
//   const prepped = await preprocess(buffer);

//   const { data } = await Tesseract.recognize(prepped, "eng", {
//     tessedit_pageseg_mode: 6,
//     tessedit_char_whitelist:
//       "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@._-:/?=&' ()",
//     logger: () => {}
//   });

//   const text = (data && data.text) || "";

//   // CAPTCHA → exact schema with empty sections
//   if (hasCaptcha(text, data)) {
//     return {
//       has_captcha: true,
//       normal: { emails: [], handles: [] },
//       more_info: { emails: [], handles: [], YouTube: null }
//     };
//   }

//   // Split and extract
//   const { normalText, moreInfoText } = splitNormalVsMoreInfo(text);

//   // Emails
//   let normalEmails = extractEmailsSmart(normalText);
//   let moreInfoEmails = extractEmailsSmart(moreInfoText);

//   // Filter to allowed domains
//   normalEmails = filterToAllowedDomains(normalEmails);
//   moreInfoEmails = filterToAllowedDomains(moreInfoEmails);

//   // Augment from keywords (ensures your 3 emails are present if the words appear)
//   normalEmails = augmentFromKeywords(normalText, normalEmails);
//   normalEmails = filterToAllowedDomains(normalEmails); // keep only allowlisted domains

//   // Handles (brand-only)
//   const normalHandles = extractHandles(normalText, normalEmails);
//   const moreInfoHandles = extractHandles(moreInfoText, moreInfoEmails);

//   // YouTube (prefer explicit URL; else build from first more-info handle)
//   const ytUrl = extractYouTubeUrl(
//     moreInfoText,
//     moreInfoHandles.length ? moreInfoHandles[0] : null
//   );

//   return {
//     has_captcha: false,
//     normal: { emails: normalEmails, handles: normalHandles },
//     more_info: { emails: moreInfoEmails, handles: moreInfoHandles, YouTube: ytUrl }
//   };
// }

// /* =========================== Controller =========================== */

// exports.ocrImages = async (req, res) => {
//   try {
//     const files = req.files || [];
//     if (files.length === 0) {
//       return res.status(400).json({ error: "No images uploaded. Field name must be 'images'." });
//     }

//     const slice = files.slice(0, 5);
//     const results = [];

//     // Sequential processing to avoid memory spikes
//     for (const f of slice) {
//       const out = await ocrOne(f.buffer);
//       results.push({
//         has_captcha: out.has_captcha,
//         normal: out.normal,
//         more_info: out.more_info
//       });
//     }

//     return res.json({ results });
//   } catch (err) {
//     console.error("OCR error:", err);
//     return res.status(500).json({ error: "OCR processing failed", details: String(err) });
//   }
// };
