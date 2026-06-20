# Pak Pon — Tech Spec

Spec lengkap & sumber kebenaran: **`docs/superpowers/specs/2026-06-20-pak-pon-design.md`**

Tech stack:
- Next.js 16.2 (App Router) + React 19.2 + TypeScript 5 strict
- Supabase (Postgres + Auth email/password + Storage private bucket `notas`)
- Gemini `gemini-3.5-flash` (fallback `gemini-3.1-pro-preview`) untuk OCR
- Vercel deploy (region `sin1` Singapore) + Vercel Cron

Schema, API contract, OCR prompt, env vars, deployment notes → lihat spec lengkap.
