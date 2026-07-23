# Graph Report - .  (2026-07-23)

## Corpus Check
- 235 files · ~248,120 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1022 nodes · 1947 edges · 100 communities (61 shown, 39 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 34 edges (avg confidence: 0.81)
- Token cost: 0 input · 547,779 output

## Community Hubs (Navigation)
- Reprint & Print Card UI
- Reports & Home Pages
- Dev Dependencies & Tooling
- Reports UI + shadcn Cards
- POS & Print Agent Design
- ESC/POS & OCR Rendering
- Runtime Dependencies
- Chip Picker & POS Cart
- AI Usage Dashboard
- Monthly Chart & Chart Primitives
- Monitor & Detail Views
- Print Agent & Queue Flow
- TypeScript Config
- Cron & Transaction Routes
- App Routes & Settings
- API Route Handlers
- shadcn Components Config
- Menu List & Dialog UI
- POS API & Chips Helpers
- Business-Day & Monitor Design
- Gemini Scan & Prompt Builder
- Scan Page & Image Compress
- Nota Item Review Form
- Menu & Printer Forms
- Transaction PATCH Handler
- Monitor Page & Helpers
- Menu Schemas & Routes
- OCR Guardrails & Anomaly
- Project Context & Cutoff
- Logging & Foundation
- Reporting & Cron Cleanup
- POS Chips & Note Presets
- Token Verify Script
- Agent ID Route
- App Layout & Nav
- Trash Page
- Vercel Config & Cron
- Scan Route & Total Parser
- Login Auth
- Scan/Review Plan Docs
- Initial Schema Migration
- Print Send Route
- FCM Push
- PWA Brand Icons
- Root Layout & Fonts
- README & Overview
- Monitor Unpaid API
- Response Schema Verify
- Android Agent DI
- AI Scan Improvements Design
- Printer Emulator
- ai_usage_daily Migration
- Menu Chips Migration
- Middleware Proxy
- Print Nota Migration
- Print Queue Migration
- Mark-Printed Queue Trigger
- Mark-Printed History Trigger
- Primary Agent Migration
- Mark-Printed On Update
- AI Usage Thoughts Tokens
- AI Usage Anomaly Count
- Print History Status
- ESLint Config
- Next Config
- PostCSS Config
- Queue Replica Identity
- Scan Confidence Migration
- Transaction Rescan Migration
- Printer Settings Migration
- Agent Label Migration
- Agent UUID Migration
- FCM Token Migration
- Items Printed Migration
- Printer Footer Migration
- Queue Item IDs Migration
- Queue Constraints Migration
- Print History Migration
- Heartbeat Status Migration
- Drop History Agent ID
- History Pending Status
- Drop Rescanned At
- Drop Alternatives Migration
- Takeaway Flag Migration
- paid_at Migration
- Scan Image Retention Migration
- File Glyph SVG
- Globe Glyph SVG
- Next.js Logo SVG
- Vercel Logo SVG
- Window Glyph SVG

## God Nodes (most connected - your core abstractions)
1. `getSupabaseServer()` - 69 edges
2. `cn()` - 63 edges
3. `tagStatus()` - 42 edges
4. `formatRp()` - 40 edges
5. `newEvent()` - 40 edges
6. `currentBusinessDate()` - 27 edges
7. `Button()` - 25 edges
8. `businessDayRange()` - 19 edges
9. `Card()` - 16 edges
10. `compilerOptions` - 16 edges

## Surprising Connections (you probably didn't know these)
- `JSON Repair Salvage` --semantically_similar_to--> `Smart Total Parser (thousands detection)`  [INFERRED] [semantically similar]
  CLAUDE.md → docs/superpowers/plans/2026-06-23-ai-scan-improvements.md
- `AppLayout()` --calls--> `getSupabaseServer()`  [EXTRACTED]
  app/(app)/layout.tsx → lib/supabase/server.ts
- `ChartTooltip()` --calls--> `formatRp()`  [EXTRACTED]
  app/(app)/setup/ai-usage/ai-usage-chart.tsx → lib/currency.ts
- `TrashPage()` --calls--> `getSupabaseServer()`  [EXTRACTED]
  app/(app)/transactions/trash/page.tsx → lib/supabase/server.ts
- `AlertDialogOverlay()` --calls--> `cn()`  [EXTRACTED]
  components/ui/alert-dialog.tsx → lib/utils.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **OCR Scan Pipeline (compress to review to save)** — docs_superpowers_plans_2026_06_20_pak_pon_scan_ocr_photo_uploader, docs_superpowers_plans_2026_06_20_pak_pon_scan_ocr_scan_nota, docs_superpowers_plans_2026_06_20_pak_pon_scan_ocr_ocr_prompt_schema, docs_superpowers_plans_2026_06_20_pak_pon_scan_ocr_review_form, docs_superpowers_plans_2026_06_20_pak_pon_scan_ocr_compute_replace_items [EXTRACTED 0.90]
- **OCR Cost + Runaway Guardrails** — claude_ocr_system, claude_runaway_guardrails, claude_json_repair, claude_anomaly_detection, claude_thinking_level [EXTRACTED 0.85]
- **POS Direct Order + Chips Feature** — claude_pos_direct_order, docs_superpowers_plans_2026_06_21_menu_note_presets_plan_a, docs_superpowers_plans_2026_06_21_pos_direct_order_plan_b, docs_superpowers_plans_2026_06_21_menu_note_presets_merge_items_by_presets [INFERRED 0.80]
- **Print revamp 3-phase migration (nota format → FCM-only → cleanup)** — docs_superpowers_plans_2026_06_25_print_revamp_phase1_nota_format_phase1_nota_format, docs_superpowers_plans_2026_06_25_print_revamp_phase2_fcm_only_web_phase2_fcm_only, docs_superpowers_plans_2026_06_25_print_revamp_phase3_cleanup_web_phase3_cleanup [EXTRACTED 1.00]
- **Print dispatch pipeline (web send → FCM → primary agent → print_history)** — docs_superpowers_plans_2026_06_25_print_revamp_phase2_fcm_only_web_post_api_print_send, docs_superpowers_plans_2026_06_25_print_revamp_phase2_fcm_only_web_fcm, docs_superpowers_plans_2026_06_26_primary_agent_selection_is_primary_column, docs_superpowers_plans_2026_06_25_print_revamp_phase2_fcm_only_web_print_history_table [INFERRED 0.85]
- **OCR cost optimization (token reduction + responseSchema enum + usage monitor)** — docs_superpowers_plans_2026_06_30_ocr_token_reduction_ocr_token_reduction, docs_superpowers_plans_2026_07_01_ocr_image_schema_optimization_ocr_image_schema_optimization, docs_superpowers_plans_2026_07_02_ai_usage_monitor_ai_usage_monitor [INFERRED 0.75]
- **FCM Print Dispatch Pipeline (send + history + trigger + flags)** — docs_superpowers_specs_2026_06_25_print_revamp_design_api_print_send, docs_superpowers_specs_2026_06_25_print_revamp_design_print_history, docs_superpowers_specs_2026_06_25_print_revamp_design_mark_items_trigger, docs_superpowers_specs_2026_06_25_print_revamp_design_printed_at_flags [EXTRACTED 0.90]
- **Print Reliability Layers (pending + poller + dedup + sweep)** — docs_superpowers_specs_2026_06_26_pending_status_print_history_design_pending_state, docs_superpowers_specs_2026_06_26_pending_status_print_history_design_pending_job_poller, docs_superpowers_specs_2026_06_26_pending_status_print_history_design_in_mem_dedup, docs_superpowers_specs_2026_06_26_pending_status_print_history_design_cron_print_sweep [EXTRACTED 0.85]
- **POS Chips Order Flow (menu_chips + api/pos + applied_chips snapshot)** — docs_superpowers_specs_2026_07_08_pos_direct_order_with_chips_design_menu_chips, docs_superpowers_specs_2026_07_08_pos_direct_order_with_chips_design_api_pos, docs_superpowers_specs_2026_07_08_pos_direct_order_with_chips_design_applied_chips_snapshot, docs_superpowers_specs_2026_07_08_pos_direct_order_with_chips_design_server_side_snapshot [EXTRACTED 0.85]
- **Pak Pon PWA/Favicon Icon Set** — public_pakpon_logo, public_android_chrome_192x192, public_android_chrome_512x512, public_apple_touch_icon, public_favicon_16x16, public_favicon_32x32 [INFERRED 0.95]
- **Next.js Default Scaffold Assets** — public_file, public_globe, public_next, public_vercel, public_window [INFERRED 0.85]

## Communities (100 total, 39 thin omitted)

### Community 0 - "Reprint & Print Card UI"
Cohesion: 0.06
Nodes (47): isKitchenItem(), MenuCategory, PrinterTarget, ReprintCard(), submitJob(), txBase, TransactionItemForPrint, Trigger (+39 more)

### Community 1 - "Reports & Home Pages"
Cohesion: 0.09
Nodes (34): currentYmWIB(), GET(), MonthlyRpc, QuerySchema, HomePage(), HomeTodayRpc, DailyReportPage(), DailyRpc (+26 more)

### Community 2 - "Dev Dependencies & Tooling"
Cohesion: 0.04
Nodes (48): eslint, eslint-config-next, jsdom, devDependencies, eslint, eslint-config-next, jsdom, shadcn (+40 more)

### Community 3 - "Reports UI + shadcn Cards"
Cohesion: 0.08
Nodes (32): Card(), CardAction(), CardContent(), CardDescription(), CardFooter(), CardHeader(), CardProps, CardTitle() (+24 more)

### Community 4 - "POS & Print Agent Design"
Cohesion: 0.07
Nodes (43): POS Direct Order (Plan B), Idempotency Key (X-Idempotency-Key), localStorage Cart Backup (pos-draft-v1), pos-client.tsx Orchestrator, shadcn Migration Design, Paper-Stamp Token Bridging, shadcn-First Component Policy, Print Agent Android App (Spec B) (+35 more)

### Community 5 - "ESC/POS & OCR Rendering"
Cohesion: 0.06
Nodes (37): lib/escpos.ts, printer_settings.footer_text, Phase 1 Nota Format & Item Flag Tracking, renderCustomerReceipt, renderKitchenTicket, lib/gemini.ts, OCR Token Reduction + Single Model, lib/prompts.ts (+29 more)

### Community 6 - "Runtime Dependencies"
Cohesion: 0.06
Nodes (35): @base-ui/react, browser-image-compression, class-variance-authority, clsx, firebase-admin, @google/genai, lucide-react, next (+27 more)

### Community 7 - "Chip Picker & POS Cart"
Cohesion: 0.13
Nodes (24): ChipOption, ChipPicker(), MenuTotal, Mismatch, CATEGORY_LABEL, CATEGORY_ORDER, MenuOption, NotaItemModal() (+16 more)

### Community 8 - "AI Usage Dashboard"
Cohesion: 0.12
Nodes (24): AiUsageChart(), ChartRow, ChartTooltip(), compact, shortDate(), AiUsageTable(), compact, shortDate() (+16 more)

### Community 9 - "Monthly Chart & Chart Primitives"
Cohesion: 0.09
Nodes (22): DAY_NAMES_ID, DayBar, dayOfWeekShort(), formatCompactRp(), MonthlyChart(), shiftMonth(), TopItem, ymLabel() (+14 more)

### Community 10 - "Monitor & Detail Views"
Cohesion: 0.14
Nodes (25): Agent, badgeClassesFor(), badgeLabelFor(), DisplayState, formatTxLabel(), Job, PrinterDebugPage(), formatTimeWIB() (+17 more)

### Community 11 - "Print Agent & Queue Flow"
Cohesion: 0.08
Nodes (30): HeartbeatRepository (agent), Print Agent Android App, PrintAgentService (foreground service), PrintRepository (agent), PrinterTcpClient, agent_heartbeats table, GET /api/agent/heartbeat, nota-review-form.tsx (+22 more)

### Community 12 - "TypeScript Config"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 13 - "Cron & Transaction Routes"
Cohesion: 0.16
Nodes (17): GET(), GET(), PatchSchema, StepResult, SupabaseLike, getSupabaseAdmin(), buildItemInsertRows(), buildScanImagePurge() (+9 more)

### Community 14 - "App Routes & Settings"
Cohesion: 0.20
Nodes (13): GET(), POST(), MenuPage(), PosPage(), savePrinterSettings(), SettingsSchema, SettingsState, PrinterSettingsPage() (+5 more)

### Community 15 - "API Route Handlers"
Cohesion: 0.16
Nodes (15): computeDisplayState(), DisplayState, GET(), POST(), GET(), POST(), CreateMenuSchema, GET() (+7 more)

### Community 16 - "shadcn Components Config"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 17 - "Menu List & Dialog UI"
Cohesion: 0.15
Nodes (15): CATEGORY_LABEL, Menu, MenuChip, MenuListClient(), Detail, DetailItem, formatTimeWIB(), MonitorDetailModal() (+7 more)

### Community 18 - "POS API & Chips Helpers"
Cohesion: 0.21
Nodes (12): POST(), CreatePosTransaction, CreatePosTransactionSchema, computeNextDailySeq(), AppliedChip, buildAppliedChipsSnapshot(), fetchChipsByMenu(), MenuChip (+4 more)

### Community 19 - "Business-Day & Monitor Design"
Cohesion: 0.14
Nodes (18): Shift-Aware Cut-off (Business Day), business_date Concept, BUSINESS_DAY_CUTOFF_HOURS Env Var, lib/date.ts Helper Module, printer-status-banner.tsx (Primary-Aware), OCR Image + Schema Optimization Design, NEXT_PUBLIC_IMAGE_MAX_WIDTH Env Var, Gemini Image Token Floor (~1089) (+10 more)

### Community 20 - "Gemini Scan & Prompt Builder"
Cohesion: 0.22
Nodes (14): client, EMPTY_RESULT, ScanAttempt, ScanMeta, scanNota(), ScanNotaResult, truncate(), balanceBrackets() (+6 more)

### Community 21 - "Scan Page & Image Compress"
Cohesion: 0.19
Nodes (9): SCAN_TIPS, PhotoUploader(), Stage, compressNotaImage(), preprocessNotaImage(), readMaxWidth(), __readMaxWidthForTest, analyzeImageQuality() (+1 more)

### Community 22 - "Nota Item Review Form"
Cohesion: 0.17
Nodes (10): NotaItem, NotaItemRow(), Tier, TIER_CLASS, tierOf(), ItemForQueue, ModalContext, Transaction (+2 more)

### Community 23 - "Menu & Printer Forms"
Cohesion: 0.23
Nodes (10): initialState, categoryOptions, ChipDraft, MenuForm(), MenuFormValues, Button(), buttonVariants, RadioGroup() (+2 more)

### Community 24 - "Transaction PATCH Handler"
Cohesion: 0.31
Nodes (7): applyHeaderUpdate(), DELETE(), GET(), PATCH(), replaceItems(), RequestEvent, tagStatus()

### Community 25 - "Monitor Page & Helpers"
Cohesion: 0.29
Nodes (9): MonitorPage(), buildPaidUpdate(), computeItemsTotal(), mapMonitorRow(), MonitorItemRow, MonitorRawRow, MonitorRow, fetchUnpaidRows() (+1 more)

### Community 26 - "Menu Schemas & Routes"
Cohesion: 0.23
Nodes (9): DELETE(), PATCH(), CategorySchema, ChipInput, ChipInputSchema, ChipsArraySchema, CreateMenu, UpdateMenu (+1 more)

### Community 27 - "OCR Guardrails & Anomaly"
Cohesion: 0.22
Nodes (11): OCR Anomaly Detection, Gemini Image Token Hard-Min Quirk, JSON Repair Salvage, OCR System (single-model + responseSchema), OCR Runaway Guardrails (defense-in-depth), Gemini 3.x thinkingLevel (not thinkingBudget), Biaya & Value Comparison, Per-Item Confidence + Alternatives (+3 more)

### Community 28 - "Project Context & Cutoff"
Cohesion: 0.22
Nodes (9): Next.js 16 Breaking Changes Warning, Pak Pon Project Context, Business Rules, Out of Scope (MVP), Product Brief, Tech Spec Pointer, lib/date.ts WIB Helpers, Business-Day Cut-off (cutoff hours env) (+1 more)

### Community 29 - "Logging & Foundation"
Cohesion: 0.22
Nodes (9): Project Conventions, Field Naming Conventions, Library Functions Do Not Log Themselves, Wide-Event Logging Pattern, Auth Middleware + Login, formatRp / parseRp Currency Util, Menu CRUD API + UI, Plan 1 Foundation, Auth, Menu Master (+1 more)

### Community 30 - "Reporting & Cron Cleanup"
Cohesion: 0.28
Nodes (9): DB-Side Aggregation (report_* functions), Monitor Meja Belum Bayar, Retensi Foto Nota 7 Hari (cron cleanup), Laporan Pemilik (Owner Report), Roadmap Backlog, Cron Cleanup (hard delete + storage), Plan 3 History + Reports + Cron, Implementation Progress Tracker (+1 more)

### Community 31 - "POS Chips & Note Presets"
Cohesion: 0.28
Nodes (9): POS Direct Order + Per-Menu Chips, computeReplaceItems Diff Helper, mergeItemsByPresets Auto-Merge, Cross-Mutex Group Validation, NotePresetSchema (label, mutex_group, price_delta), Plan A Menu Note Presets (Chips), NotePresetPicker + NotePresetEditor, POS idempotency_key Column (+1 more)

### Community 32 - "Token Verify Script"
Cohesion: 0.22
Nodes (7): buf, genai, maxInput, minInput, results, supabase, variations

### Community 33 - "Agent ID Route"
Cohesion: 0.43
Nodes (5): DELETE(), isUuid(), PATCH(), AgentPatchInput, AgentPatchSchema

### Community 34 - "App Layout & Nav"
Cohesion: 0.32
Nodes (5): AppLayout(), links, Nav(), SetupMenu(), Toaster()

### Community 35 - "Trash Page"
Cohesion: 0.43
Nodes (6): TrashPage(), formatDateWIB(), formatTimeWIB(), relativeDaysAgo(), TransactionTrashRow(), TrashRow

### Community 36 - "Vercel Config & Cron"
Cohesion: 0.25
Nodes (7): sin1, maxDuration, crons, framework, functions, app/api/scan/route.ts, regions

### Community 37 - "Scan Route & Total Parser"
Cohesion: 0.48
Nodes (4): POST(), recordUsageDaily(), detectThousandsMissing(), ThousandsHint

### Community 38 - "Login Auth"
Cohesion: 0.48
Nodes (5): loginAction(), LoginSchema, LoginState, initialState, LoginPage()

### Community 39 - "Scan/Review Plan Docs"
Cohesion: 0.38
Nodes (7): OCR Prompt + Zod Schema Builder, PhotoUploader (compress + upload), Plan 2 Scan + OCR + Review + Save, Nota Review Form + Item Modal, scanNota Gemini Wrapper, shadcn Migration Plan, Paper-Stamp Theme Token Bridging

### Community 40 - "Initial Schema Migration"
Cohesion: 0.48
Nodes (6): menus, set_updated_at(), transaction_items, transactions, trg_menus_updated, trg_transactions_updated

### Community 41 - "Print Send Route"
Cohesion: 0.53
Nodes (3): POST(), PrintSendInput, PrintSendSchema

### Community 42 - "FCM Push"
Cohesion: 0.47
Nodes (5): adminApp(), INVALID_FCM_ERROR_CODES, PushAgentArgs, PushAgentResult, pushPrintJob()

### Community 43 - "PWA Brand Icons"
Cohesion: 0.33
Nodes (6): Android Chrome PWA Icon 192px, Android Chrome PWA Icon 512px, Apple Touch Icon (Pak Pon Brand), Favicon 16px (Pak Pon Brand), Favicon 32px (Pak Pon Brand), Pak Pon Pecel Lele Full Logo (JPG)

### Community 44 - "Root Layout & Fonts"
Cohesion: 0.40
Nodes (3): fraunces, jakarta, metadata

### Community 45 - "README & Overview"
Cohesion: 0.40
Nodes (5): Print System (FCM-only dispatch), Core Flow (kasir foto nota to print), Pak Pon Web App (README), pak-pon-print-agent (Android companion), Tech Stack

### Community 46 - "Monitor Unpaid API"
Cohesion: 0.50
Nodes (5): GET /api/monitor, lib/monitor.ts, /monitor route, Monitor Meja Belum Bayar, transactions.paid_at column

### Community 47 - "Response Schema Verify"
Cohesion: 0.40
Nodes (3): client, MENUS, schema

### Community 49 - "Android Agent DI"
Cohesion: 0.50
Nodes (4): AuthRepository (agent), ServiceLocator (manual DI), SettingsRepository (agent EncryptedPrefs), SupabaseClientFactory (agent)

### Community 50 - "AI Scan Improvements Design"
Cohesion: 0.67
Nodes (4): AI Scan Improvements Design, Menu Alternatives Chip Swap, Per-Item Confidence Highlighting, lib/total-parser.ts (Thousands Hint)

### Community 51 - "Printer Emulator"
Cohesion: 0.50
Nodes (3): OUT_DIR, PORT, server

### Community 53 - "Menu Chips Migration"
Cohesion: 0.50
Nodes (3): menu_chips, transaction_items, trg_menu_chips_updated

## Knowledge Gaps
- **310 isolated node(s):** `MenuChip`, `Menu`, `CATEGORY_LABEL`, `HomeTodayRpc`, `DailyRpc` (+305 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **39 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Runtime Dependencies` to `Monthly Chart & Chart Primitives`, `Dev Dependencies & Tooling`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `react` connect `Monthly Chart & Chart Primitives` to `Runtime Dependencies`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `getSupabaseServer()` connect `App Routes & Settings` to `Agent ID Route`, `Reports & Home Pages`, `App Layout & Nav`, `Trash Page`, `Scan Route & Total Parser`, `Login Auth`, `AI Usage Dashboard`, `Print Send Route`, `Cron & Transaction Routes`, `API Route Handlers`, `POS API & Chips Helpers`, `Transaction PATCH Handler`, `Monitor Page & Helpers`, `Menu Schemas & Routes`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **What connects `MenuChip`, `Menu`, `CATEGORY_LABEL` to the rest of the system?**
  _310 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Reprint & Print Card UI` be split into smaller, more focused modules?**
  _Cohesion score 0.06352087114337568 - nodes in this community are weakly interconnected._
- **Should `Reports & Home Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.08928571428571429 - nodes in this community are weakly interconnected._
- **Should `Dev Dependencies & Tooling` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._