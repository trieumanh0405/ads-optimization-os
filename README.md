# Ads Optimization OS

Ứng dụng nội bộ giúp media buyer chuẩn hóa dữ liệu, chạy rule chung theo KPI của từng brand và tạo Action Queue có giải thích/audit. Đây là tool vận hành thật; màn hình mặc định không chứa sample data.

> Rule engine deterministic là nguồn tạo action. AI chỉ phân tích supporting metrics, nêu giả thuyết và đề xuất bước kiểm tra; AI không thay đổi action và không gọi Meta Ads API trong v1.

## Luồng sử dụng đã hoạt động

1. Tạo project/brand, chọn platform, KPI, target, result definition và sales model.
2. Import CSV thật từ Ads Manager/connector.
3. Auto-map hoặc chỉnh tay data contract, supporting metrics và context dimensions.
4. Chọn Strict/Partial import; xem lỗi theo dòng trước khi lưu.
5. Chỉnh lookback, weights, CBO/ABO guardrails và rule records.
6. Chạy engine theo Today, Short, Long, Lifetime và parent/project context.
7. Xem đề xuất ở Campaign, Ad set, Ad cùng rule, evidence, metric, target và confidence.
8. Review action, chuyển `DONE`, `REJECTED`, `DEFERRED` và giữ append-only audit log.
9. Dùng OpenAI, OpenRouter, Anthropic, Gemini hoặc endpoint tương thích để phân tích bổ sung bằng playbook Noti/Panasonic.

## Persistence

Ứng dụng có hai lane rõ ràng:

- **Browser workspace — dùng ngay:** IndexedDB lưu project, mapping, fact rows, rules, runs, actions và AI analysis trong browser hiện tại. Có Export/Restore JSON để backup hoặc chuyển máy. API key AI chỉ được giữ trong session nếu người dùng chọn.
- **Team backend — tùy chọn:** các API Firebase/Firestore có sẵn cho project, import, run, action và encrypted provider keys. Lane này cần Firebase credentials và custom claims; giao diện browser hiện không tự bật team sync khi chưa cấu hình.

Không lưu customer data hoặc API key vào Git. Với production nhiều người dùng, cấu hình Firebase/Auth trước khi coi browser workspace là nguồn dữ liệu dùng chung.

## KPI và metric

Metric chuẩn:

- CPL, CPQL, CPA, ROAS
- CTR (%), CPC, CVR (%), CPM

Mỗi project có thể thêm KPI riêng từ field chuẩn hoặc supporting metric đã map, ví dụ:

```text
CPBOOKING = spend / metrics.bookedAppointment
```

Metric thiếu giữ nguyên `null`; không bị đổi thành `0`. `result` có thể là Lead, Message, Purchase, Booking… tùy mapping của project.

## Rule engine

Rule là record có version, không phải chuỗi `IF` trong UI:

```text
rule_id, entity_level, metric_key, score_source, evaluation_field,
evidence_source, min_spend, min_results, operator, thresholds,
action_code, action_value, priority, enabled
```

Engine hỗ trợ:

- Achievement luôn chuẩn hóa về “cao hơn là tốt”.
- Rule dùng achievement, metric value, spend, result, qualified result hoặc revenue.
- Zero-result rule vẫn chạy được sau minimum spend dù CPA/CPL hiện tại là `null`.
- Conflict cùng priority trả `REVIEW_MANUALLY`.
- Campaign chỉ scale budget CBO; Ad set chỉ scale budget ABO; Ad không sở hữu budget.
- Dữ liệu stale/invalid chặn destructive recommendation.
- Action có cùng evidence hash không bị tạo lại, kể cả action cũ đã terminal.

Chi tiết tại [Core engine specification](docs/CORE_ENGINE.md).

## AI diagnostics

Provider hỗ trợ:

- OpenAI-compatible (OpenAI, OpenRouter, gateway hoặc endpoint HTTPS công khai)
- Anthropic
- Google Gemini

Playbook tích hợp:

- Noti Meta performance diagnosis
- Noti content, funnel & creative
- Panasonic Vietnam case guardrails

Các skill được chuyển thành playbook có version, required/optional metrics, missing-data behavior và prohibited actions. Không copy số liệu Panasonic thành benchmark cho brand khác. Xem [AI playbooks](docs/PLAYBOOKS.md).

## Chạy local

Yêu cầu Node.js 20+ và pnpm.

```bash
pnpm install
pnpm dev
```

Browser workspace không cần `.env`. Để bật Firebase APIs, copy `.env.example` thành `.env.local` và điền credentials.

Kiểm tra trước khi commit:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Fixture E2E không được load vào sản phẩm: `test-fixtures/e2e-lead-ads.csv`.

## Cấu trúc repository

```text
src/
  ai/          provider adapters, contracts, versioned playbooks
  app/         Next.js UI, styles and API routes
  components/  operational product screens
  core/        data contract, formulas, windows, QC, rules, actions
  product/     local workspace defaults, mapping and persistence
  server/      Firebase authorization, repositories and encryption
docs/
  PRD.md
  ARCHITECTURE.md
  CORE_ENGINE.md
  API.md
  PLAYBOOKS.md
  CONTRIBUTING.md
```

## Tài liệu

- [PRD và acceptance criteria](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API contracts](docs/API.md)
- [Contributing](docs/CONTRIBUTING.md)

## Deploy Vercel

Import repository vào Vercel hoặc dùng Vercel CLI. Browser workspace chạy không cần service trả phí. Nếu dùng Firebase team backend, thêm Firebase env vars và production domain vào Firebase Authentication authorized domains.

Endpoint kiểm tra: `GET /api/health`.
