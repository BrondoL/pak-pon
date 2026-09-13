# Graph Report - .  (2026-09-13)

## Corpus Check
- 304 files · ~328,903 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1274 nodes · 2851 edges · 136 communities (79 shown, 57 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.8)
- Token cost: 426,824 input · 0 output

## Community Hubs (Navigation)
- Add-Item Modals & Cart Draft
- Printer Settings & Reprint Card
- POS & Append-Items API
- ESC/POS Rendering & OCR Prompts
- Multi-Akun: Rationale & Traps
- History & Money Visibility
- NPM Dependencies
- Monitor Page & Add-Item Tests
- AI Usage Charts & Table
- Monthly Report Chart
- Reports API (Daily & Monthly)
- Heartbeat, Signout & Cron Routes
- Android Print Agent (Spec)
- Users & Roles API
- TypeScript Config
- POS, Scan & Printer Pages
- Printer Debug & Monitor Board
- Menu List & Printer Form
- Chip Picker & Item Modals
- Date Filter & Card Primitives
- shadcn Component Config
- Mobile Nav & Setup Menu
- Permission Catalog & Role Schemas
- Multi-Akun: Design Decisions
- Menus CRUD API
- Logging & Scan Review Docs
- Nav Links & Menu/Reports Pages
- Gemini Client & Prompts
- App Layout & Home Page
- Users Client UI
- Photo Upload & Compression
- Product Brief & Business Rules
- Roles Client UI
- Print Revamp & FCM Dispatch
- Test & Lint Dev Dependencies
- shadcn Migration & POS Chips
- Business Day Cut-off
- NPM Scripts
- Print Agent Service & Heartbeat
- Token Verify Script
- Agent Admin API
- Transaction Trash
- Printer Status Banner
- OCR Image & AI Usage Design
- Vercel Deploy Config
- Login Flow
- Initial Schema Migration
- Print Send API
- Roles Setup Page
- FCM Push Helper
- Brand Icons & Logo
- Root Layout & Fonts
- Foundation Plan (Auth & Menu)
- Monitor Unpaid Orders
- Print History & Item Flags
- Package Manifest
- Printer Emulator Script
- Response Schema Verify Script
- AuthRepository (agent)
- POS Direct Order (Plan B)
- AI Scan Improvements Design
- Retensi Foto Nota 7 Hari Design
- AI Usage Daily Migration
- Menu Chips Migration
- Printing-At Migration
- Biaya & Value Comparison
- Per-Item Confidence + Alternatives
- proxy.ts
- 0004_print_nota.sql
- 0005_print_queue.sql
- 0016_mark_items_printed_trigger.sql
- 0020_mark_items_printed_history_trigger.…
- 0024_agent_heartbeats_is_primary.sql
- 0026_mark_items_printed_on_update.sql
- 0029_ai_usage_thoughts_tokens.sql
- 0033_ai_usage_anomaly_count.sql
- 0035_print_history_printing_status.sql
- 0048_last_superadmin_guard.sql
- eslint.config.mjs
- eslint-config-next
- jsdom
- next.config.ts
- shadcn
- tailwindcss
- @tailwindcss/postcss
- @testing-library/react
- @types/node
- @types/react-dom
- typescript
- @vercel/config
- vitest
- @vitest/coverage-v8
- postcss.config.mjs
- 0006_print_queue_replica_identity.sql
- 0007_scan_confidence.sql
- 0008_transaction_rescan.sql
- 0009_printer_settings.sql
- 0010_print_queue_agent_label.sql
- 0011a_agent_heartbeats_agent_uuid.sql
- 0012_agent_heartbeats_fcm_token.sql
- 0013_transaction_items_printed.sql
- 0014_printer_settings_footer.sql
- 0015_print_queue_item_ids.sql
- 0017_print_queue_constraints.sql
- 0018_print_history.sql
- 0019_agent_heartbeats_status.sql
- 0023_drop_print_history_agent_id.sql
- 0025_print_history_pending_status.sql
- 0027_drop_rescanned_at.sql
- 0030_drop_alternatives.sql
- 0031_transactions_is_takeaway.sql
- 0036_transactions_paid_at.sql
- 0037_scan_image_retention.sql
- 0040_print_history_claim_source.sql
- 0041_claimed_via_manual.sql
- 0046_transactions_created_by.sql
- Next.js 16 Breaking Changes Warning
- Tech Spec Pointer
- File/Document Glyph SVG
- Globe Glyph SVG
- Next.js Wordmark Logo SVG
- Vercel Triangle Logo SVG
- Browser Window Glyph SVG

## God Nodes (most connected - your core abstractions)
1. `getSupabaseServer()` - 83 edges
2. `cn()` - 67 edges
3. `newEvent()` - 54 edges
4. `tagStatus()` - 44 edges
5. `formatRp()` - 42 edges
6. `guard()` - 41 edges
7. `requirePermission()` - 35 edges
8. `Button()` - 30 edges
9. `currentBusinessDate()` - 27 edges
10. `Spec: Multi-User Roles Design` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Permissions computed per-request from DB (not baked into JWT)` --rationale_for--> `getCurrentActor`  [EXTRACTED]
  docs/superpowers/specs/2026-09-13-multi-user-roles-design.md → lib/auth/session.ts
- `report_monthly RPC in-function permission guard (SECURITY DEFINER)` --shares_data_with--> `can()`  [INFERRED]
  docs/superpowers/specs/2026-09-13-multi-user-roles-design.md → lib/permissions.ts
- `Invarian minimal satu superadmin aktif dijaga di DB (migrasi 0048)` --conceptually_related_to--> `canDemoteSuperadmin()`  [EXTRACTED]
  CLAUDE.md → lib/permissions.ts
- `Redirect-loop bug: /login vs /no-access for deactivated accounts` --rationale_for--> `NoAccessPage()`  [EXTRACTED]
  CLAUDE.md → app/(auth)/no-access/page.tsx
- `Plan: Multi-Akun & Role dengan Permission Dinamis` --references--> `NoAccessPage()`  [EXTRACTED]
  docs/superpowers/plans/2026-09-13-multi-user-roles.md → app/(auth)/no-access/page.tsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **OCR Scan Pipeline (compress to review to save)** — docs_superpowers_plans_2026_06_20_pak_pon_scan_ocr_photo_uploader, docs_superpowers_plans_2026_06_20_pak_pon_scan_ocr_scan_nota, docs_superpowers_plans_2026_06_20_pak_pon_scan_ocr_ocr_prompt_schema, docs_superpowers_plans_2026_06_20_pak_pon_scan_ocr_review_form, docs_superpowers_plans_2026_06_20_pak_pon_scan_ocr_compute_replace_items [EXTRACTED 0.90]
- **Print revamp 3-phase migration (nota format → FCM-only → cleanup)** — docs_superpowers_plans_2026_06_25_print_revamp_phase1_nota_format_phase1_nota_format, docs_superpowers_plans_2026_06_25_print_revamp_phase2_fcm_only_web_phase2_fcm_only, docs_superpowers_plans_2026_06_25_print_revamp_phase3_cleanup_web_phase3_cleanup [EXTRACTED 1.00]
- **Print dispatch pipeline (web send → FCM → primary agent → print_history)** — docs_superpowers_plans_2026_06_25_print_revamp_phase2_fcm_only_web_post_api_print_send, docs_superpowers_plans_2026_06_25_print_revamp_phase2_fcm_only_web_fcm, docs_superpowers_plans_2026_06_26_primary_agent_selection_is_primary_column, docs_superpowers_plans_2026_06_25_print_revamp_phase2_fcm_only_web_print_history_table [INFERRED 0.85]
- **OCR cost optimization (token reduction + responseSchema enum + usage monitor)** — docs_superpowers_plans_2026_06_30_ocr_token_reduction_ocr_token_reduction, docs_superpowers_plans_2026_07_01_ocr_image_schema_optimization_ocr_image_schema_optimization, docs_superpowers_plans_2026_07_02_ai_usage_monitor_ai_usage_monitor [INFERRED 0.75]
- **FCM Print Dispatch Pipeline (send + history + trigger + flags)** — docs_superpowers_specs_2026_06_25_print_revamp_design_api_print_send, docs_superpowers_specs_2026_06_25_print_revamp_design_print_history, docs_superpowers_specs_2026_06_25_print_revamp_design_mark_items_trigger, docs_superpowers_specs_2026_06_25_print_revamp_design_printed_at_flags [EXTRACTED 0.90]
- **Print Reliability Layers (pending + poller + dedup + sweep)** — docs_superpowers_specs_2026_06_26_pending_status_print_history_design_pending_state, docs_superpowers_specs_2026_06_26_pending_status_print_history_design_pending_job_poller, docs_superpowers_specs_2026_06_26_pending_status_print_history_design_in_mem_dedup, docs_superpowers_specs_2026_06_26_pending_status_print_history_design_cron_print_sweep [EXTRACTED 0.85]
- **POS Chips Order Flow (menu_chips + api/pos + applied_chips snapshot)** — docs_superpowers_specs_2026_07_08_pos_direct_order_with_chips_design_menu_chips, docs_superpowers_specs_2026_07_08_pos_direct_order_with_chips_design_api_pos, docs_superpowers_specs_2026_07_08_pos_direct_order_with_chips_design_applied_chips_snapshot, docs_superpowers_specs_2026_07_08_pos_direct_order_with_chips_design_server_side_snapshot [EXTRACTED 0.85]
- **Next.js Default Scaffold Assets** — public_file, public_globe, public_next, public_vercel, public_window [INFERRED 0.85]
- **Pak Pon PWA/Favicon Icon Set** — public_pakpon_logo, public_android_chrome_192x192, public_android_chrome_512x512, public_apple_touch_icon, public_favicon_16x16, public_favicon_32x32 [INFERRED 0.95]
- **Nota customer print dispatch lifecycle (create -> auto-print -> moved to pay button)** — lib_print_dispatch_dispatchcustomerreceiptjob, components_pos_pos_client_posclient, components_nota_review_form_notareviewform, components_reprint_card_reprintcard, components_monitor_board_markpaid [EXTRACTED 1.00]
- **Unified tap-to-add cart system shared across POS, review, monitor** — lib_cart_draft_addorincrementdraft, components_add_items_modal_additemsmodal, components_pos_pos_menu_picker_posmenupicker, components_monitor_add_item_modal_monitoradditemmodal, components_nota_review_form_notareviewform [EXTRACTED 1.00]
- **Multi-user role permission gate system (catalog + DB + server gate + nav filter)** — lib_permissions_resolveactor, lib_auth_session_guard, lib_auth_session_requirepermission, lib_nav_links_visiblenavlinks, supabase_migrations_0042_roles_and_profiles_profiles [EXTRACTED 1.00]
- **Unified tap-to-add mechanism across POS, Monitor, and Review** — lib_cart_draft_needschipconfig, lib_cart_draft_addorincrementdraft, components_add_items_modal, components_monitor_add_item_modal, components_pos_pos_client, components_nota_review_form, components_pos_pos_menu_picker [INFERRED 0.85]
- **Print job timing measurement pipeline (kirim/cetak/agent split)** — migration_0039_printing_at, migration_0040_claimed_via_receive_to_claim_ms, lib_print_duration_computejobduration, lib_print_duration_jobduration, app_api_print_history_route, app_app_setup_printer_debug_page [INFERRED 0.85]
- **Dynamic role/permission gating flow** — lib_permissions_permissions, lib_permissions_resolvepermissions, lib_permissions_can, lib_auth_session_getcurrentactor, lib_auth_session_requirepermission, lib_auth_session_guard, migration_0042_roles_and_profiles [INFERRED 0.85]

## Communities (136 total, 57 thin omitted)

### Community 0 - "Add-Item Modals & Cart Draft"
Cohesion: 0.06
Nodes (70): AddItemsModal(), MonitorAddItemModal(), titleFor(), MenuOption, NotaItemModal(), NotaItem, NotaItemRow(), Tier (+62 more)

### Community 1 - "Printer Settings & Reprint Card"
Cohesion: 0.06
Nodes (47): PrinterSettingsForm(), isKitchenItem(), MenuCategory, PrinterTarget, ReprintCard(), submitJob(), txBase, TransactionItemForPrint (+39 more)

### Community 2 - "POS & Append-Items API"
Cohesion: 0.13
Nodes (22): POST(), CreatePosTransaction, CreatePosTransactionSchema, AppendItemsSchema, POST(), applyHeaderUpdate(), DELETE(), GET() (+14 more)

### Community 3 - "ESC/POS Rendering & OCR Prompts"
Cohesion: 0.06
Nodes (37): lib/escpos.ts, printer_settings.footer_text, Phase 1 Nota Format & Item Flag Tracking, renderCustomerReceipt, renderKitchenTicket, lib/gemini.ts, OCR Token Reduction + Single Model, lib/prompts.ts (+29 more)

### Community 4 - "Multi-Akun: Rationale & Traps"
Cohesion: 0.10
Nodes (30): DurationView(), NoAccessPage(), REVOKE FROM public tidak mencabut grant anon (Postgres DEFAULT PRIVILEGES), Invarian minimal satu superadmin aktif dijaga di DB (migrasi 0048), Redirect-loop bug: /login vs /no-access for deactivated accounts, Delay cetak = FCM hilang, bukan FCM lambat, claimed_via fcm-vs-poll distinction (FCM loss signal), done_at dual-meaning trap (claim time vs finish time) (+22 more)

### Community 5 - "History & Money Visibility"
Cohesion: 0.10
Nodes (30): formatRangeLabel(), SearchParams, TransactionsPage(), report_monthly permission guard + ACL rename trap, MoneyToggle(), MoneyValue(), MoneyVisibilityContext, MoneyVisibilityProvider() (+22 more)

### Community 6 - "NPM Dependencies"
Cohesion: 0.06
Nodes (35): @base-ui/react, browser-image-compression, class-variance-authority, clsx, firebase-admin, @google/genai, lucide-react, next (+27 more)

### Community 7 - "Monitor Page & Add-Item Tests"
Cohesion: 0.09
Nodes (17): MonitorPage(), menus, menusWithMutex, formatTimeWIB(), MonitorBoard(), txDetail, fetchActiveMenusWithChips(), MenuRow (+9 more)

### Community 8 - "AI Usage Charts & Table"
Cohesion: 0.12
Nodes (24): AiUsageChart(), ChartRow, ChartTooltip(), compact, shortDate(), AiUsageTable(), compact, shortDate() (+16 more)

### Community 9 - "Monthly Report Chart"
Cohesion: 0.09
Nodes (22): DAY_NAMES_ID, DayBar, dayOfWeekShort(), formatCompactRp(), MonthlyChart(), shiftMonth(), TopItem, ymLabel() (+14 more)

### Community 10 - "Reports API (Daily & Monthly)"
Cohesion: 0.17
Nodes (23): DailyRpc, GET(), QuerySchema, currentYmWIB(), GET(), MonthlyRpc, QuerySchema, GET() (+15 more)

### Community 11 - "Heartbeat, Signout & Cron Routes"
Cohesion: 0.17
Nodes (18): computeDisplayState(), DisplayState, GET(), POST(), GET(), GET(), GET(), GET() (+10 more)

### Community 12 - "Android Print Agent (Spec)"
Cohesion: 0.08
Nodes (30): HeartbeatRepository (agent), Print Agent Android App, PrintAgentService (foreground service), PrintRepository (agent), PrinterTcpClient, agent_heartbeats table, GET /api/agent/heartbeat, nota-review-form.tsx (+22 more)

### Community 13 - "Users & Roles API"
Cohesion: 0.15
Nodes (23): DELETE(), PATCH(), GET(), POST(), RoleListRow, RoleWriteSchema, DELETE(), isLastSuperadminViolation() (+15 more)

### Community 14 - "TypeScript Config"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 15 - "POS, Scan & Printer Pages"
Cohesion: 0.15
Nodes (17): PosPage(), SCAN_TIPS, ScanPage(), PrinterDebugPage(), SetupPrinterPage(), savePrinterSettings(), SettingsSchema, SettingsState (+9 more)

### Community 16 - "Printer Debug & Monitor Board"
Cohesion: 0.16
Nodes (23): Agent, badgeClassesFor(), badgeLabelFor(), DisplayState, formatTxLabel(), Job, PrinterDebugClient(), formatDateLongWIB() (+15 more)

### Community 17 - "Menu List & Printer Form"
Cohesion: 0.15
Nodes (17): CATEGORY_LABEL, Menu, MenuChip, MenuListClient(), initialState, MenuTotal, Mismatch, categoryOptions (+9 more)

### Community 18 - "Chip Picker & Item Modals"
Cohesion: 0.17
Nodes (16): ChipOption, ChipPicker(), Detail, DetailItem, formatTimeWIB(), MonitorDetailModal(), CATEGORY_LABEL, CATEGORY_ORDER (+8 more)

### Community 19 - "Date Filter & Card Primitives"
Cohesion: 0.15
Nodes (21): STATUS_LABELS, TAKEAWAY_LABELS, CardAction(), CardContent(), CardDescription(), CardFooter(), CardHeader(), CardProps (+13 more)

### Community 20 - "shadcn Component Config"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 21 - "Mobile Nav & Setup Menu"
Cohesion: 0.14
Nodes (16): MobileNav(), SetupMenu(), DropdownMenu(), DropdownMenuCheckboxItem(), DropdownMenuContent(), DropdownMenuGroup(), DropdownMenuItem(), DropdownMenuLabel() (+8 more)

### Community 22 - "Permission Catalog & Role Schemas"
Cohesion: 0.15
Nodes (12): RoleWrite, actorWith(), firstRole(), isPermissionKey(), KASIR_SEED_PERMISSIONS, KEY_SET, PERMISSION_KEYS, PermissionDef (+4 more)

### Community 23 - "Multi-Akun: Design Decisions"
Cohesion: 0.13
Nodes (20): ForbiddenPage(), DELETE primary print agent blocked 409 (existing print-system pattern), Permission catalog lives in code, grants live in DB, Permissions computed per-request from DB (not baked into JWT), report_monthly RPC in-function permission guard (SECURITY DEFINER), Accepted risk: transactions/menus/print_history RLS stays "authenticated ALL", RLS recursion trap on profiles — needs SECURITY DEFINER is_superadmin(), role_id ON DELETE RESTRICT — must reassign users before deleting role (+12 more)

### Community 24 - "Menus CRUD API"
Cohesion: 0.19
Nodes (14): DELETE(), PATCH(), GET(), POST(), CategorySchema, ChipInput, ChipInputSchema, ChipsArraySchema (+6 more)

### Community 25 - "Logging & Scan Review Docs"
Cohesion: 0.13
Nodes (18): Field Naming Conventions, Library Functions Do Not Log Themselves, Wide-Event Logging Pattern, computeReplaceItems Diff Helper, OCR Prompt + Zod Schema Builder, PhotoUploader (compress + upload), Plan 2 Scan + OCR + Review + Save, Nota Review Form + Item Modal (+10 more)

### Community 26 - "Nav Links & Menu/Reports Pages"
Cohesion: 0.24
Nodes (12): MenuPage(), ReportsPage(), Nav(), requireAnyPermission(), allowed(), NAV_LINKS, SETUP_LINKS, visibleNavLinks() (+4 more)

### Community 27 - "Gemini Client & Prompts"
Cohesion: 0.22
Nodes (14): client, EMPTY_RESULT, ScanAttempt, ScanMeta, scanNota(), ScanNotaResult, truncate(), balanceBrackets() (+6 more)

### Community 28 - "App Layout & Home Page"
Cohesion: 0.21
Nodes (9): AppLayout(), HomePage(), HomeTodayRpc, accentClasses, HomeTiles(), Tile, tiles, Toaster() (+1 more)

### Community 29 - "Users Client UI"
Cohesion: 0.24
Nodes (8): ApiErrorBody, UserRow, UsersClient(), DateFilter(), labelFrom(), roleLabel(), RoleOption, roles

### Community 30 - "Photo Upload & Compression"
Cohesion: 0.24
Nodes (8): PhotoUploader(), Stage, compressNotaImage(), preprocessNotaImage(), readMaxWidth(), __readMaxWidthForTest, analyzeImageQuality(), QualityReport

### Community 31 - "Product Brief & Business Rules"
Cohesion: 0.17
Nodes (12): Business Rules, Out of Scope (MVP), Product Brief, Cron Cleanup (hard delete + storage), lib/date.ts WIB Helpers, Plan 3 History + Reports + Cron, Business-Day Cut-off (cutoff hours env), Shift-Aware Cut-off Plan (+4 more)

### Community 32 - "Roles Client UI"
Cohesion: 0.24
Nodes (6): ApiErrorBody, GROUPS, DialogDescription(), Switch(), Textarea(), PermissionGroup

### Community 33 - "Print Revamp & FCM Dispatch"
Cohesion: 0.29
Nodes (11): Print System Revamp Design, POST /api/print/send, renderCustomerReceipt (price + footer), FCM-Only Dispatch Architecture, Pending Status di Print History Design, cron /api/cron/print-sweep (5min), ProcessingDedup In-Memory Set, PendingJobPoller (60s Fallback) (+3 more)

### Community 34 - "Test & Lint Dev Dependencies"
Cohesion: 0.18
Nodes (11): eslint, devDependencies, eslint, @testing-library/dom, @testing-library/jest-dom, @testing-library/user-event, @types/react, @testing-library/dom (+3 more)

### Community 35 - "shadcn Migration & POS Chips"
Cohesion: 0.27
Nodes (10): shadcn Migration Design, Paper-Stamp Token Bridging, shadcn-First Component Policy, renderKitchenTicket (double-size, no price), POS Direct Order + Per-Menu Chips Design, POST /api/pos, applied_chips jsonb Snapshot, menu_chips Table (+2 more)

### Community 36 - "Business Day Cut-off"
Cohesion: 0.27
Nodes (10): Shift-Aware Cut-off (Business Day), business_date Concept, BUSINESS_DAY_CUTOFF_HOURS Env Var, lib/date.ts Helper Module, printer-status-banner.tsx (Primary-Aware), Monitor Meja Belum Bayar Design, GET /api/monitor, /monitor Route + Polling (15s) (+2 more)

### Community 37 - "NPM Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, emulator:customer, emulator:dapur, emulator:minuman, lint, start (+2 more)

### Community 38 - "Print Agent Service & Heartbeat"
Cohesion: 0.31
Nodes (9): Print Agent Android App (Spec B), PrintAgentService Foreground Service, Heartbeat Loop (30s), PrinterTcpClient (port 9100), Print Nota Web Refactor (Spec A, Queue), agent_heartbeats Table, print_queue Table, RawBT Intent Approach Abandoned (+1 more)

### Community 39 - "Token Verify Script"
Cohesion: 0.22
Nodes (7): buf, genai, maxInput, minInput, results, supabase, variations

### Community 40 - "Agent Admin API"
Cohesion: 0.43
Nodes (5): DELETE(), isUuid(), PATCH(), AgentPatchInput, AgentPatchSchema

### Community 41 - "Transaction Trash"
Cohesion: 0.43
Nodes (6): TrashPage(), formatDateWIB(), formatTimeWIB(), relativeDaysAgo(), TransactionTrashRow(), TrashRow

### Community 42 - "Printer Status Banner"
Cohesion: 0.29
Nodes (3): Agent, DisplayState, PrinterStatusBanner()

### Community 43 - "OCR Image & AI Usage Design"
Cohesion: 0.32
Nodes (8): OCR Image + Schema Optimization Design, NEXT_PUBLIC_IMAGE_MAX_WIDTH Env Var, Gemini Image Token Floor (~1089), responseSchema Menu Enum Migration, AI Usage Monitor Design, ai_usage_daily Table, lib/pricing.ts (estimateCostIdr), recordUsageDaily() + increment RPC

### Community 44 - "Vercel Deploy Config"
Cohesion: 0.25
Nodes (7): sin1, maxDuration, crons, framework, functions, app/api/scan/route.ts, regions

### Community 45 - "Login Flow"
Cohesion: 0.48
Nodes (5): loginAction(), LoginSchema, LoginState, initialState, LoginPage()

### Community 46 - "Initial Schema Migration"
Cohesion: 0.48
Nodes (6): menus, set_updated_at(), transaction_items, transactions, trg_menus_updated, trg_transactions_updated

### Community 47 - "Print Send API"
Cohesion: 0.53
Nodes (3): POST(), PrintSendInput, PrintSendSchema

### Community 48 - "Roles Setup Page"
Cohesion: 0.40
Nodes (5): RoleListRow, RolesPage(), RoleRow, RolesClient(), requireSuperadmin()

### Community 49 - "FCM Push Helper"
Cohesion: 0.47
Nodes (5): adminApp(), INVALID_FCM_ERROR_CODES, PushAgentArgs, PushAgentResult, pushPrintJob()

### Community 50 - "Brand Icons & Logo"
Cohesion: 0.33
Nodes (6): Android Chrome PWA Icon 192px, Android Chrome PWA Icon 512px, Apple Touch Icon (Pak Pon Brand), Favicon 16px (Pak Pon Brand), Favicon 32px (Pak Pon Brand), Pak Pon Pecel Lele Full Logo (JPG)

### Community 51 - "Root Layout & Fonts"
Cohesion: 0.40
Nodes (3): fraunces, jakarta, metadata

### Community 52 - "Foundation Plan (Auth & Menu)"
Cohesion: 0.40
Nodes (5): Auth Middleware + Login, formatRp / parseRp Currency Util, Menu CRUD API + UI, Plan 1 Foundation, Auth, Menu Master, Initial Schema Migration (menus, transactions, items)

### Community 53 - "Monitor Unpaid Orders"
Cohesion: 0.50
Nodes (5): GET /api/monitor, lib/monitor.ts, /monitor route, Monitor Meja Belum Bayar, transactions.paid_at column

### Community 54 - "Print History & Item Flags"
Cohesion: 0.40
Nodes (5): JobProcessor (Agent), mark_items_printed_history Trigger, print_history Table, transaction_items.printed_dapur/minuman_at Flags, Pending State (Proof of Dispatch)

### Community 55 - "Package Manifest"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 56 - "Printer Emulator Script"
Cohesion: 0.40
Nodes (3): OUT_DIR, PORT, server

### Community 57 - "Response Schema Verify Script"
Cohesion: 0.40
Nodes (3): client, MENUS, schema

### Community 59 - "AuthRepository (agent)"
Cohesion: 0.50
Nodes (4): AuthRepository (agent), ServiceLocator (manual DI), SettingsRepository (agent EncryptedPrefs), SupabaseClientFactory (agent)

### Community 60 - "POS Direct Order (Plan B)"
Cohesion: 0.50
Nodes (4): POS Direct Order (Plan B), Idempotency Key (X-Idempotency-Key), localStorage Cart Backup (pos-draft-v1), pos-client.tsx Orchestrator

### Community 61 - "AI Scan Improvements Design"
Cohesion: 0.67
Nodes (4): AI Scan Improvements Design, Menu Alternatives Chip Swap, Per-Item Confidence Highlighting, lib/total-parser.ts (Thousands Hint)

### Community 62 - "Retensi Foto Nota 7 Hari Design"
Cohesion: 0.83
Nodes (4): Retensi Foto Nota 7 Hari Design, cron cleanup Pass-3 (Purge Foto), mapTransactionSource() Helper, scan_image_purged_at Column

### Community 64 - "Menu Chips Migration"
Cohesion: 0.50
Nodes (3): menu_chips, transaction_items, trg_menu_chips_updated

### Community 65 - "Printing-At Migration"
Cohesion: 0.67
Nodes (3): print_history, print_history_stamp_printing_at, stamp_print_history_printing_at()

### Community 66 - "Biaya & Value Comparison"
Cohesion: 0.67
Nodes (3): Biaya & Value Comparison, Laporan Pemilik (Owner Report), Roadmap Backlog

### Community 67 - "Per-Item Confidence + Alternatives"
Cohesion: 0.67
Nodes (3): Per-Item Confidence + Alternatives, AI Scan Improvements Plan, Smart Total Parser (thousands detection)

## Ambiguous Edges - Review These
- `Migration 0043 — transactions.created_by` → `report_monthly RPC in-function permission guard (SECURITY DEFINER)`  [AMBIGUOUS]
  docs/superpowers/specs/2026-09-13-multi-user-roles-design.md · relation: conceptually_related_to

## Knowledge Gaps
- **365 isolated node(s):** `MenuChip`, `Menu`, `CATEGORY_LABEL`, `HomeTodayRpc`, `DailyRpc` (+360 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **57 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Migration 0043 — transactions.created_by` and `report_monthly RPC in-function permission guard (SECURITY DEFINER)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `dependencies` connect `NPM Dependencies` to `Monthly Report Chart`, `Package Manifest`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `react` connect `Monthly Report Chart` to `NPM Dependencies`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `cn()` connect `Date Filter & Card Primitives` to `Roles Client UI`, `History & Money Visibility`, `Monthly Report Chart`, `Printer Debug & Monitor Board`, `Menu List & Printer Form`, `Chip Picker & Item Modals`, `Mobile Nav & Setup Menu`, `Users Client UI`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **What connects `MenuChip`, `Menu`, `CATEGORY_LABEL` to the rest of the system?**
  _365 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Add-Item Modals & Cart Draft` be split into smaller, more focused modules?**
  _Cohesion score 0.05661729574773053 - nodes in this community are weakly interconnected._
- **Should `Printer Settings & Reprint Card` be split into smaller, more focused modules?**
  _Cohesion score 0.05961426066627703 - nodes in this community are weakly interconnected._