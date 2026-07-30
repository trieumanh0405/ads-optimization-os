# Ads Optimization OS

Tài liệu này là hướng dẫn tổng thể cho người vận hành, người kiểm tra logic và developer của Ads Optimization OS.

Production: [https://ads-optimization-app.vercel.app](https://ads-optimization-app.vercel.app)

> Ads Optimization OS là hệ thống hỗ trợ quyết định cho media buyer đã có tư duy tối ưu quảng cáo. Tool chuẩn hóa dữ liệu, chạy rule thống nhất và tạo Action Queue có thể truy vết. V1 không tự gọi Meta Ads API để tắt/mở quảng cáo hoặc thay ngân sách.

## Mục lục

1. [Đọc nhanh trong 5 phút](#1-đọc-nhanh-trong-5-phút)
2. [Kiến trúc và nơi lưu dữ liệu](#2-kiến-trúc-và-nơi-lưu-dữ-liệu)
3. [Khái niệm cần hiểu](#3-khái-niệm-cần-hiểu)
4. [Data contract và mapping](#4-data-contract-và-mapping)
5. [Nguồn dữ liệu, import và refresh](#5-nguồn-dữ-liệu-import-và-refresh)
6. [Metric và công thức KPI](#6-metric-và-công-thức-kpi)
7. [Time window và weighted achievement](#7-time-window-và-weighted-achievement)
8. [Entity score và context score](#8-entity-score-và-context-score)
9. [Rule engine](#9-rule-engine)
10. [Rule mặc định](#10-rule-mặc-định)
11. [Guardrail và confidence](#11-guardrail-và-confidence)
12. [Decision Board và Action Queue](#12-decision-board-và-action-queue)
13. [Data QC và mã lỗi](#13-data-qc-và-mã-lỗi)
14. [Cách sử dụng từng màn hình](#14-cách-sử-dụng-từng-màn-hình)
15. [Quy trình vận hành đề xuất](#15-quy-trình-vận-hành-đề-xuất)
16. [AI diagnostics và playbook](#16-ai-diagnostics-và-playbook)
17. [Hướng dẫn tìm bug](#17-hướng-dẫn-tìm-bug)
18. [Giới hạn hiện tại](#18-giới-hạn-hiện-tại)
19. [Phân quyền team](#19-phân-quyền-team)
20. [Development, deployment và kiểm thử](#20-development-deployment-và-kiểm-thử)

---

## 1. Đọc nhanh trong 5 phút

### Tool trả lời câu hỏi gì?

Với mỗi Campaign, Ad set và Ad, tool cố gắng trả lời:

- Có đủ dữ liệu để quyết định chưa?
- Hiệu quả so với KPI project là bao nhiêu?
- Nên `KEEP`, `TURN_OFF`, `DECREASE_BUDGET`, `INCREASE_BUDGET` hay `REVIEW_MANUALLY`?
- Rule nào tạo ra kết luận?
- Rule dùng dữ liệu Today, 3D, 7D hay Lifetime?
- Entity có thực sự sở hữu ngân sách không?
- Ai đã duyệt/thực hiện action và thực hiện lúc nào?

### Luồng hệ thống

```text
Google Sheets / CSV / BigQuery trong tương lai
  -> scan header
  -> mapping cột riêng cho từng brand
  -> normalize thành FactRow chuẩn
  -> Data QC
  -> tổng hợp Campaign / Ad set / Ad
  -> tính KPI theo Today / Short / Long / Lifetime
  -> quy đổi thành Achievement
  -> trộn Entity score với Parent/Project context
  -> chạy rule theo priority
  -> áp dụng CBO/ABO và scale guardrail
  -> Decision Board
  -> Action Queue
  -> Media buyer thao tác trong Ads Manager
  -> DONE / REJECTED / DEFERRED
  -> append-only Action Log
                       \
                        -> AI diagnostics (chỉ phân tích thêm)
```

### Ba nguyên tắc quan trọng nhất

1. Thiếu metric là `null/N/A`, không tự đổi thành `0`.
2. Rule deterministic quyết định action; AI không được override rule.
3. Tool chỉ đề xuất; media buyer vẫn là người xác nhận và thao tác trong Ads Manager.

---

## 2. Kiến trúc và nơi lưu dữ liệu

### Thành phần

| Thành phần | Chức năng |
|---|---|
| Next.js trên Vercel | Giao diện, API routes, rule engine và AI proxy |
| Supabase Auth | Đăng nhập magic link |
| Supabase PostgreSQL | Project config, facts, runs, Action Queue và Action Log |
| Google Sheets | Nguồn raw data chính trong giai đoạn hiện tại |
| Browser IndexedDB | Browser workspace/local cache và chế độ dùng cá nhân |
| AI provider | OpenAI-compatible, Anthropic hoặc Gemini do người dùng nhập key |

### Team workspace và Browser workspace

| Chế độ | Nơi lưu chính | Phù hợp |
|---|---|---|
| Team workspace | Supabase | Team dùng chung, phân quyền project, lịch sử tập trung |
| Browser workspace | IndexedDB của trình duyệt | Test local/cá nhân/offline |

Trong Team workspace, Supabase là source of truth. Đóng browser hoặc reload không được làm mất project đã lưu thành công trên Supabase.

### Dữ liệu nằm ở đâu?

| Dữ liệu | Nơi lưu |
|---|---|
| Raw export đầy đủ | Google Sheets/Drive |
| Project/KPI/window/guardrail | bảng `projects` |
| Metric dictionary và rules | bảng `projects` |
| Fact đã chuẩn hóa | bảng `facts` |
| Lịch sử import | bảng `import_runs` |
| Engine snapshot | bảng `optimization_runs` |
| Action đang xử lý | bảng `action_queue` |
| Lịch sử chuyển trạng thái action | bảng `action_log` |
| API key AI trong Browser BYOK | chỉ trong request hoặc `sessionStorage` nếu người dùng chọn nhớ trong session |

Không đưa `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` hoặc AI API key vào GitHub, Google Sheet hay ảnh debug công khai.

---

## 3. Khái niệm cần hiểu

| Khái niệm | Ý nghĩa |
|---|---|
| Project/Brand | Một tài khoản hoặc dự án quảng cáo có KPI/rule riêng |
| Entity | Campaign, Ad set hoặc Ad |
| Raw row | Một dòng lấy từ Ads Manager/connector |
| FactRow | Một raw row đã được đổi sang data contract chuẩn |
| Primary KPI | KPI chính dùng để ra quyết định, ví dụ CPL, CPQL, CPA, ROAS |
| Target | Mức KPI mục tiêu của project |
| Window | Khoảng ngày dùng để tổng hợp bằng chứng |
| Achievement | Điểm đã quy đổi để luôn hiểu là “cao hơn = tốt hơn” |
| Entity score | Achievement tổng hợp của chính entity |
| Context score | Achievement của parent hoặc toàn project |
| Decision score | Entity score trộn với context score |
| Evidence | Spend/result/metric tối thiểu để rule được phép quyết định |
| Recommendation | Kết quả engine trên Decision Board |
| Action | Recommendation cần người dùng xử lý, được đưa vào Action Queue |
| As-of date | Ngày chốt dữ liệu của một engine run |
| Run | Snapshot bất biến của config/rule/data tại một thời điểm |

---

## 4. Data contract và mapping

### FactRow chuẩn

Mỗi dòng sau normalize có cấu trúc:

```text
projectId
platform
accountId
date
hour
entityLevel
campaignId
adsetId
adId
entityName
status
budgetType
budget
spend
result
qualifiedResult
revenue
impressions
clicks
metrics
dimensions
sourceUpdatedAt
sourceRowKey
```

### Trường bắt buộc và điều kiện

| Field | Bắt buộc | Ghi chú |
|---|---:|---|
| `projectId`, `platform`, `accountId` | Có | Lấy từ config project |
| `date` | Có | Chuẩn `YYYY-MM-DD` sau normalize |
| `entityLevel` | Có | `CAMPAIGN`, `ADSET`, `AD` |
| `campaignId` | Có | Mọi cấp đều cần |
| `adsetId` | Với Ad set/Ad | Ad cần cả parent Ad set |
| `adId` | Với Ad | ID của Ad |
| `entityName` | Có | Tên entity ở cấp đang import |
| `status` | Không | Mặc định `UNKNOWN` |
| `budgetType` | Có | `CBO`, `ABO`, `NONE`, `UNKNOWN` |
| `spend` | Có | Phải là số không âm |
| `result`, `qualifiedResult`, `revenue` | Không | Thiếu thì `null`, không phải `0` |
| `impressions`, `clicks` | Không | Thiếu thì `null` |
| `sourceUpdatedAt` | Có | Cột nguồn hoặc thời điểm connector/import đọc dữ liệu |
| `sourceRowKey` | Có | Khóa idempotency do tool tạo |

### Supporting metrics

Metric phụ không thuộc canonical core được lưu tại:

```json
{
  "metrics": {
    "reach": 10000,
    "linkClicks": 350,
    "messagingConversations": 20,
    "purchases": 5
  }
}
```

Supporting metrics được dùng cho:

- Custom KPI.
- AI diagnostics.
- Phân tích CTR link, Frequency, video, message, purchase…

### Context dimensions

Các chiều phân tích bổ sung nằm trong:

```json
{
  "dimensions": {
    "campaignName": "Lead Gen 2026",
    "adsetName": "Broad 25-44",
    "objective": "OUTCOME_LEADS",
    "optimizationGoal": "LEAD_GENERATION",
    "learningStatus": "LEARNING",
    "postId": "123456789"
  }
}
```

`campaignName` và `adsetName` giúp tool hiển thị tên parent khi raw data chỉ ở cấp Ad.

### Cách tạo `sourceRowKey`

```text
projectId | date | hour | entityLevel | campaignId | adsetId | adId
```

Khóa này giúp import lại cùng dòng sẽ upsert thay vì nhân đôi.

Lưu ý: nếu một export có nhiều breakdown row cho cùng ngày/entity nhưng khác placement, age, gender… mà các breakdown đó không nằm trong `sourceRowKey`, các dòng sẽ bị coi là trùng. Khi dùng breakdown phải thiết kế lại grain/key trước khi import.

### Quy tắc parse số

Normalizer xử lý cả:

- `1,234.56`
- `1.234,56`
- `1,234`
- `1.234`
- ký hiệu tiền tệ và khoảng trắng

Sau normalize, số không hợp lệ trở thành `null`; field bắt buộc hoặc schema không hợp lệ sẽ sinh lỗi.

---

## 5. Nguồn dữ liệu, import và refresh

### CSV

Tool hỗ trợ:

- Dấu phẩy.
- Dấu chấm phẩy.
- Tab.

CSV phù hợp để test hoặc xử lý offline. CSV không tự refresh.

### Google Sheets

Điều kiện:

1. Google Sheets API đã được enable.
2. Vercel có server-only variable `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. Sheet đã share quyền Viewer cho email service account.
4. Project đang dùng Team workspace/Supabase.

### Import lần đầu

1. Vào `Data import`.
2. Chọn `Google Sheets`.
3. Nhập URL hoặc Spreadsheet ID.
4. Nhập tên raw tab và dòng header.
5. Chọn tần suất auto refresh.
6. Bấm `Kết nối & quét cột`.
7. Kiểm tra mapping.
8. Chọn CBO/ABO/không có budget.
9. Dùng Strict để validate lần đầu.
10. Bấm `Validate & import`.

Mapping được lưu theo project. Mỗi brand có thể có tên cột, thứ tự cột và KPI khác nhau.

### Strict và Partial

| Mode | Hành vi | Dùng khi |
|---|---|---|
| Strict | Một dòng lỗi sẽ chặn toàn batch | Setup nguồn lần đầu, kiểm tra contract |
| Partial | Chỉ lưu dòng hợp lệ, liệt kê dòng bị bỏ | Nguồn đã ổn định và chấp nhận loại row lỗi |

Partial không có nghĩa là tự sửa dữ liệu sai.

### Auto refresh

- Mặc định: 60 phút.
- Có thể chọn từ 30 phút đến 6 giờ trên UI.
- Chỉ chạy khi có một Team workspace đang mở.
- Nhiều user/tab mở cùng project không đọc lại Sheet nhiều lần trong cùng chu kỳ; server áp dụng throttle.
- Nút `Refresh & auto-run` là manual force refresh, bỏ qua throttle.
- Nếu `Auto-run after sync` bật, engine tự chạy sau khi refresh thành công.
- Auto-run dùng ngày lớn nhất trong fact mới làm `asOfDate`.

Nếu Sheet không có cột timestamp, mỗi lần sync sẽ gán `sourceUpdatedAt` bằng thời điểm sync hiện tại. Nếu Sheet có timestamp riêng, tool giữ timestamp nguồn để QC freshness.

### Giới hạn dữ liệu hiện tại

- Google Sheets reader: tối đa 20.000 data rows.
- Supabase fact reader của một workspace/run: tối đa 20.000 facts, đọc theo page 1.000 rows.
- Upload fact được chia batch nhỏ để tránh Vercel `413 Payload Too Large`.
- BigQuery chưa được kết nối trong UI; đây là nguồn dự kiến khi dữ liệu vượt giới hạn Google Sheets.

### Công thức thô khi refresh

```text
Sheet rows
  -> bỏ dòng hoàn toàn rỗng
  -> nếu có header Date/Account/Campaign/Ad set/Ad:
       bỏ row padding/formula-only không có identity/date anchor
  -> giới hạn 20.000 rows
  -> normalize bằng mapping đã lưu
  -> upsert theo projectId + sourceRowKey
  -> ghi import history
  -> tùy chọn chạy engine
```

---

## 6. Metric và công thức KPI

Metric được cấu hình như record; engine không hard-code theo từng brand.

### Metric chuẩn

| Metric | Công thức | Direction |
|---|---|---|
| CPL | `spend / result` | Lower is better |
| CPQL | `spend / qualifiedResult` | Lower is better |
| CPA | `spend / result` | Lower is better |
| ROAS | `revenue / spend` | Higher is better |
| CTR (%) | `clicks / impressions × 100` | Higher is better |
| CPC | `spend / clicks` | Lower is better |
| CVR (%) | `result / clicks × 100` | Higher is better |
| CPM | `spend / impressions × 1.000` | Lower is better |

### Quy tắc denominator

Nếu denominator:

- Bằng `0`.
- Bị thiếu.
- Là `null`.

Thì metric mặc định là `null/N/A`, không phải vô cực và không phải `0`.

Ví dụ:

```text
Spend = 500.000
Result = 0
CPL = N/A
```

Trường hợp đã tiêu nhưng chưa có result được xử lý bằng rule riêng dùng `SPEND`/`RESULTS`, không ép CPL thành một con số giả.

### Aggregate trước, tính ratio sau

Engine thực hiện:

```text
Window CPL = SUM(spend trong window) / SUM(result trong window)
```

Engine không lấy trung bình CPL từng ngày:

```text
Sai: AVERAGE(CPL ngày 1, CPL ngày 2, CPL ngày 3)
```

Điều này tránh ngày ít spend/ít result có trọng số ngang với ngày lớn.

### Custom metric

Custom metric gồm:

```text
key
label
kind = SUM | RATIO | RATE
numerator
denominator
multiplier
direction
nullWhenDenominatorZero
```

Operand có thể là canonical field hoặc:

```text
metrics.<metricKey>
```

Ví dụ Cost per Booking:

```text
key: CPBOOKING
kind: RATIO
numerator: spend
denominator: metrics.bookedAppointment
multiplier: 1
direction: LOWER_IS_BETTER
```

---

## 7. Time window và weighted achievement

### Biên thời gian

Với `asOfDate = D`:

```text
TODAY    = [D, D + 1 ngày)
SHORT    = [D - shortDays, D)
LONG     = [D - longDays, D)
LIFETIME = [projectStartDate, D + 1 ngày)
```

Today không nằm trong Short và Long.

Ví dụ `asOfDate = 2026-07-30`:

| Window | Ngày được tính |
|---|---|
| Today | 30/07 |
| Short 3D | 27/07, 28/07, 29/07 |
| Long 7D | 23/07 đến 29/07 |
| Lifetime | Project start đến hết 30/07 |

Lưu ý: Short nằm trong Long. Hai window này không độc lập hoàn toàn; chúng chỉ không chứa Today.

### Achievement

Mọi metric được đổi về cùng một chiều “cao hơn là tốt”.

Lower-is-better:

```text
achievement = target / actual
```

Higher-is-better:

```text
achievement = actual / target
```

Ví dụ CPL target 100.000:

| CPL thực tế | Achievement |
|---:|---:|
| 200.000 | 0,50 = 50% |
| 100.000 | 1,00 = 100% |
| 80.000 | 1,25 = 125% |

Ví dụ ROAS target 3:

| ROAS thực tế | Achievement |
|---:|---:|
| 1,5 | 0,50 = 50% |
| 3,0 | 1,00 = 100% |
| 4,5 | 1,50 = 150% |

### Default window config

| Window | Days | Weight | Required |
|---|---:|---:|---:|
| Today | N/A | 35% | Không |
| Short | 3 | 35% | Có |
| Long | 7 | 20% | Không |
| Lifetime | N/A | 10% | Không |

Tổng weight phải bằng 100%.

### Weighted achievement

```text
windowScore =
  Σ(achievement_i × weight_i)
  / Σ(weight_i của window có dữ liệu)
```

- Optional window bị thiếu: bỏ window đó và renormalize phần weight còn lại.
- Required window bị thiếu: toàn `windowScore = null`.

Ví dụ:

```text
Today achievement = 80%, weight 35%
Short achievement = 100%, weight 35%
Long achievement = 120%, weight 20%
Lifetime thiếu, weight 10% optional

windowScore
= (0,8×0,35 + 1,0×0,35 + 1,2×0,20) / (0,35+0,35+0,20)
= 96,67%
```

---

## 8. Entity score và context score

Sau window score, engine áp dụng lớp weight thứ hai:

```text
decisionScore =
  entityWindowScore × entityWeight
  + contextWindowScore × contextWeight
```

### Context theo cấp

| Entity | Context ưu tiên |
|---|---|
| Campaign | Toàn project |
| Ad set | Parent Campaign, fallback toàn project |
| Ad | Parent Ad set → Campaign → toàn project |

### Default context weight

| Level | Entity | Context |
|---|---:|---:|
| Campaign | 70% | 30% |
| Ad set | 65% | 35% |
| Ad | 65% | 35% |

Mỗi cặp phải cộng thành 100%.

Ví dụ:

```text
Ad window score = 80%
Parent Ad set score = 110%
Ad context weights = 65% / 35%

decisionScore = 0,8×0,65 + 1,1×0,35 = 90,5%
```

Ý nghĩa: Ad đang kém, nhưng engine vẫn biết parent đang tốt; rule có thể dùng `CONTEXT_WEIGHTED` để tránh đánh giá entity hoàn toàn tách khỏi bối cảnh.

### Tổng hợp từ cấp Ad

Nếu import chỉ có Ad rows nhưng có đầy đủ `campaignId` và `adsetId`, engine tự tạo evidence:

```text
Ad rows
  -> group thành Ad set
  -> group thành Campaign
```

Tên parent lấy từ `dimensions.adsetName` và `dimensions.campaignName`, nếu thiếu thì dùng ID.

Nếu raw data đã có rows Ad set hoặc Campaign riêng, engine ưu tiên cấp explicit đó, không tạo trùng cấp tương ứng.

---

## 9. Rule engine

### Cấu trúc một rule

| Field | Chức năng |
|---|---|
| `ruleSetId`, `version` | Xác định bộ rule và phiên bản |
| `entityLevel` | Campaign/Ad set/Ad |
| `metricKey` | KPI mà rule áp dụng |
| `scoreSource` | Giá trị/window được so sánh |
| `evaluationField` | Achievement, KPI thật, Spend, Result… |
| `evidenceSource` | Window dùng để kiểm tra đủ sample |
| `minSpendAbsolute` | Spend tối thiểu tuyệt đối |
| `minSpendTargetMultiple` | Spend tối thiểu theo bội số target |
| `minResults` | Result/qualified result tối thiểu |
| `operator` | `<`, `≤`, `>`, `≥`, `BETWEEN` |
| `thresholdFrom`, `thresholdTo` | Ngưỡng match |
| `actionCode`, `actionValue` | Action và % adjustment |
| `priority` | Số lớn hơn thắng |
| `enabled` | Bật/tắt rule |

### `scoreSource` khác `evidenceSource`

Đây là phần dễ nhầm nhất.

- `scoreSource`: lấy con số nào để so với threshold.
- `evidenceSource`: kiểm tra entity đã tiêu/ra result đủ để được quyền quyết định chưa.

Ví dụ:

```text
scoreSource = CONTEXT_WEIGHTED
evaluationField = ACHIEVEMENT
evidenceSource = SHORT
minSpendTargetMultiple = 2
minResults = 1
operator = LT
thresholdFrom = 0,7
```

Rule chỉ được xét khi Short đã tiêu ít nhất `2 × KPI target` và có ít nhất 1 result. Sau đó mới so `contextWeightedAchievement < 70%`.

### Evaluation field

| Field | Giá trị được so |
|---|---|
| `ACHIEVEMENT` | Achievement của scoreSource |
| `METRIC_VALUE` | KPI thật của một window |
| `SPEND` | Tổng spend |
| `RESULTS` | Tổng result |
| `QUALIFIED_RESULTS` | Tổng qualified result |
| `REVENUE` | Tổng revenue |

`WEIGHTED` và `CONTEXT_WEIGHTED` chỉ hợp lệ với `ACHIEVEMENT`. Với field khác, score sẽ là `null`.

### Operator

```text
LT       value < thresholdFrom
LTE      value <= thresholdFrom
GT       value > thresholdFrom
GTE      value >= thresholdFrom
BETWEEN  thresholdFrom <= value < thresholdTo
```

### Evidence threshold

```text
spendThreshold =
  MAX(
    minSpendAbsolute hoặc 0,
    minSpendTargetMultiple × projectTarget hoặc 0
  )
```

```text
evidence đủ khi:
  spend trong evidence windows >= spendThreshold
  VÀ evidenceCount >= minResults
```

Với CPQL, `evidenceCount` dùng `qualifiedResult`. Với metric có denominator khác, engine hiện dùng `result`.

`minSpendTargetMultiple` chỉ hợp lệ với cost ratio có:

- Numerator là `spend`.
- Direction là `LOWER_IS_BETTER`.

Vì vậy không dùng bội số target spend trực tiếp cho ROAS/CTR.

### Thứ tự engine

1. Parse request bằng schema.
2. Chạy Data QC.
3. Nếu có fatal QC: run `BLOCKED`, không tạo recommendation/action.
4. Bỏ facts sau `asOfDate`.
5. Tổng hợp hierarchy và windows.
6. Tính metric, achievement, entity/context score.
7. Lọc rule đúng set/version/entity/metric và đang enabled.
8. Kiểm tra minimum evidence.
9. Match operator/threshold.
10. Chọn priority cao nhất.
11. Nếu cùng priority nhưng khác action: `REVIEW_MANUALLY`.
12. Áp dụng status/budget/scale guardrail.
13. Sắp thứ tự Ad → Ad set → Campaign.
14. Tạo Action Queue cho recommendation cần xử lý.

---

## 10. Rule mặc định

Khi tạo project, tool sinh rule riêng cho Campaign, Ad set và Ad.

### Với CPL/CPA/CPQL

| Rule | Evidence | Điều kiện | Action | Priority |
|---|---|---|---|---:|
| No result stop | Today | Spend ≥ `1,5 × target`, result phù hợp ≤ 0 | Turn off | 100 |
| Critical under target | Short | Spend ≥ `2 × target`, min 1 result, score < 70% | Turn off | 90 |
| Watch | Short | Spend ≥ `1 × target`, min 1 result, 70% ≤ score < 95% | Ad: Turn off; parent: Decrease 15% | 70 |
| Keep | Short | Spend ≥ `0,5 × target`, min 1 result, 95% ≤ score < 120% | Keep | 50 |
| Scale | Short | Spend ≥ `1 × target`, min 3 results, score ≥ 120% | Ad: Keep; parent: Increase 20% | 60 |

Mỗi rule được tạo cho cả ba entity level, tổng cộng 15 rules.

### Với ROAS/CTR/CPC/CVR/CPM hoặc custom metric không thuộc CPL/CPA/CPQL

- Không có rule No-result mặc định.
- Bốn rule Critical/Watch/Keep/Scale được tạo cho mỗi cấp.
- `minSpendAbsolute = 1`.
- `minResults = 0`.
- Cần review lại methodology theo mục tiêu business trước khi dùng nguyên default.

### Rule zero result

Cost-per-result bằng `N/A` khi result = 0. Rule No-result không dựa trên CPL; nó dùng:

```text
evaluationField = RESULTS hoặc QUALIFIED_RESULTS
scoreSource = TODAY
spend evidence >= 1,5 × target
value <= 0
```

Nhờ vậy entity tiêu nhiều nhưng chưa có result vẫn có thể bị đề xuất tắt.

---

## 11. Guardrail và confidence

### Budget ownership

| Entity | Được xem là sở hữu budget khi |
|---|---|
| Campaign | `budgetType = CBO` |
| Ad set | `budgetType = ABO` |
| Ad | Không bao giờ |

Nếu rule đề xuất budget action sai owner:

```text
recommendedAction = REVIEW_MANUALLY
reason = ENTITY_DOES_NOT_OWN_BUDGET
```

### Status guardrail

Entity được xem là active khi status là:

```text
ACTIVE | ENABLED | DELIVERING
```

- Turn off entity đã inactive → `KEEP`.
- Scale entity inactive → `REVIEW_MANUALLY`.

Nếu nguồn không map đúng status và tất cả là `UNKNOWN`, một số action sẽ bị chuyển sang manual review.

### Scale guardrail

Mặc định:

```text
maxDailyScalePct = 20%
maxDailyScaleActions = 3
deferParentScaleWhenChildAction = true
```

- Adjustment vượt 20% sẽ bị cap về ±20%.
- Action tăng budget vượt số lượng cho phép trong một run → manual review.
- Parent có Ad child cần tắt thì parent scale có thể bị defer để xử lý child trước.

### Confidence

```text
resultConfidence =
  MIN(1, evidenceCount / MAX(1, minResults × 2))
```

```text
rowConfidence =
  MIN(1, số evidence rows / 3)
```

```text
confidence =
  resultConfidence × 70%
  + rowConfidence × 30%
```

Confidence là độ mạnh của sample theo rule, không phải xác suất action chắc chắn đúng.

### Reason code chính

| Reason code | Ý nghĩa |
|---|---|
| `NO_RULES_CONFIGURED` | Không có rule hợp lệ cho level/KPI/version |
| `MINIMUM_EVIDENCE_NOT_MET` | Chưa đủ spend/result hoặc score còn null |
| `NO_RULE_MATCH` | Đủ evidence nhưng không nằm trong khoảng rule nào |
| `CONFLICTING_RULES` | Cùng priority nhưng action trái nhau |
| `ENTITY_ALREADY_INACTIVE` | Entity đã inactive nên không tắt lại |
| `INACTIVE_ENTITY_CANNOT_SCALE` | Entity inactive không được scale |
| `AD_CANNOT_OWN_BUDGET` | Ad không sở hữu budget |
| `ENTITY_DOES_NOT_OWN_BUDGET` | CBO/ABO không khớp cấp action |
| `ADJUSTMENT_CAPPED_BY_GUARDRAIL` | % thay đổi bị cap |
| `DAILY_SCALE_LIMIT_REACHED` | Vượt số scale actions/run |
| `EXECUTE_CHILD_ACTIONS_FIRST` | Cần xử lý Ad child trước khi scale parent |

---

## 12. Decision Board và Action Queue

### Recommendation

Engine có sáu action code:

| Code | Ý nghĩa |
|---|---|
| `PENDING_DATA` | Chưa đủ dữ liệu để quyết định |
| `KEEP` | Đạt rule giữ |
| `TURN_OFF` | Đề xuất tắt |
| `DECREASE_BUDGET` | Đề xuất giảm ngân sách |
| `INCREASE_BUDGET` | Đề xuất tăng ngân sách |
| `REVIEW_MANUALLY` | Có conflict/guardrail/khoảng rule chưa cover |

### Decision Board hiển thị

- Entity level, ID và name.
- KPI Today.
- Target.
- Context-weighted achievement.
- Action/adjustment.
- Confidence.
- Matched rule và reason.
- Evidence drawer.
- Performance theo Today/Short/Long/Lifetime.

`KPI Today = N/A` không có nghĩa toàn entity không có dữ liệu. Có thể Today trống nhưng Short/Long vẫn có evidence.

### Run optimization

Mỗi run là snapshot.

Không cần bấm thủ công sau mỗi auto refresh nếu `Auto-run after sync` đang bật.

Cần bấm `Run optimization` khi:

- Vừa sửa KPI target.
- Vừa sửa rules.
- Vừa sửa window/context/guardrail.
- Muốn chạy một `asOfDate` lịch sử.
- Auto-run đang tắt.

### Action Queue

`KEEP` và `PENDING_DATA` chỉ nằm trên Decision Board, không tạo action.

Các action còn lại có thể đi vào Action Queue:

```text
PENDING -> DONE
PENDING -> REJECTED
PENDING -> DEFERRED
DEFERRED -> PENDING
DEFERRED -> DONE
DEFERRED -> REJECTED
```

`DONE` và `REJECTED` là terminal; không chuyển ngược.

### Execution phase

```text
Phase 1 = Ad
Phase 2 = Ad set
Phase 3 = Campaign
```

Media buyer nên xử lý theo phase để child action hoàn tất trước parent scaling.

### Chống duplicate action

Evidence hash dùng:

```text
entityId
recommendedAction
currentMetric
contextWeightedAchievement
matchedRuleIds
reasonCodes
```

```text
actionKey =
projectId | entityLevel | entityId | action | 16 ký tự đầu evidenceHash
```

Nếu actionKey đã tồn tại, engine không tạo action trùng, kể cả action trước đã DONE/REJECTED. Khi evidence hash thay đổi, action mới có thể được tạo.

---

## 13. Data QC và mã lỗi

Fatal issue làm run `BLOCKED`. Warning vẫn cho run tiếp tục.

| Code | Mức | Ý nghĩa/cách kiểm tra |
|---|---|---|
| `RAW_DATA_EMPTY` | Fatal | Project chưa có fact |
| `DUPLICATE_SOURCE_KEYS` | Fatal | Có sourceRowKey trùng trong stored facts |
| `MISSING_ENTITY_ID` | Fatal | Entity không có ID đúng cấp |
| `BROKEN_ENTITY_HIERARCHY` | Fatal | Ad/Ad set thiếu parent ID |
| `PROJECT_ID_MISMATCH` | Fatal | Fact thuộc project khác |
| `ACCOUNT_OR_PLATFORM_MISMATCH` | Fatal | Account/platform fact khác config |
| `SOURCE_DATA_STALE` | Fatal | `sourceUpdatedAt` vượt freshness hours |
| `PRIMARY_METRIC_UNDEFINED` | Fatal | Primary KPI không có trong metric dictionary |
| `TARGET_MULTIPLE_INVALID_FOR_METRIC` | Fatal | Dùng target spend multiple cho metric không phù hợp |
| `WINDOW_WEIGHTS_NOT_100` | Fatal | Window weights không cộng thành 1 |
| `CONTEXT_WEIGHTS_*_NOT_100` | Fatal | Entity/context weight không cộng thành 1 |
| `FUTURE_DATED_ROWS` | Warning | Fact sau asOfDate bị bỏ khỏi run |

Import-level error thường gặp:

| Code | Ý nghĩa |
|---|---|
| `REQUIRED_VALUE_MISSING` | Mapping bắt buộc đang trống |
| `invalid_type` | Giá trị không parse được đúng type |
| `DUPLICATE_SOURCE_KEY_IN_IMPORT` | Hai raw rows tạo cùng sourceRowKey |

---

## 14. Cách sử dụng từng màn hình

### Tổng quan

Dùng để:

- Xem tất cả brand/project.
- Chọn project đang vận hành.
- Kiểm tra checklist project đã có config, facts, rules và run chưa.

### Project & KPI

Kiểm tra lần lượt:

1. Project name/platform/account ID.
2. Timezone/currency/start date.
3. Primary KPI.
4. Ý nghĩa Result, ví dụ Lead/Message/Purchase/Booking.
5. Target.
6. Sales model/tracking confidence/CAPI.
7. Metric definitions.
8. Window days/weights/required.
9. Entity/context weights.
10. Freshness hours và scale guardrails.

Sau khi đổi Primary KPI, kiểm tra lại toàn bộ rules. Không giả định rules cũ phù hợp KPI mới.

### Data import

Checklist:

- Đúng Sheet và tab.
- Đúng header row.
- Đúng entity level.
- Đúng CBO/ABO.
- Campaign/Ad set/Ad IDs không map nhầm sang name.
- Spend map đúng tiền tệ.
- Result đúng conversion event.
- Qualified Result đúng CRM metric.
- Revenue đúng conversion value.
- `sourceUpdatedAt` hợp lệ.
- Supporting metrics không bị map trùng nghĩa.

Lần đầu dùng Strict. Chỉ dùng Partial sau khi đã hiểu vì sao row bị bỏ.

### Rule engine

Mỗi rule phải trả lời được:

1. Rule áp dụng cấp nào?
2. So Achievement hay KPI/Spend/Result thật?
3. Dùng window nào để so?
4. Dùng window nào để xác nhận đủ evidence?
5. Minimum spend/result là gì?
6. Threshold có để hở khoảng nào không?
7. Priority có conflict không?
8. Entity có sở hữu budget không?

Sau khi sửa rule:

- Bấm `Lưu rule`.
- Sang Decision Board.
- Chạy lại optimization.
- Mở evidence drawer của một entity test.

### Decision Board

1. Kiểm tra fact count.
2. Kiểm tra lần refresh cuối.
3. Kiểm tra `asOfDate`.
4. Refresh nếu cần.
5. Run nếu config/rule vừa thay đổi.
6. Lọc theo level/action.
7. Mở từng entity để xem window metrics.
8. Đọc matched rule và reason code.

### Action Queue

1. Lọc `PENDING`.
2. Xử lý Ad trước, rồi Ad set, rồi Campaign.
3. Thao tác thật trong Ads Manager.
4. Ghi note.
5. Chọn:
   - `DONE`: đã thực hiện.
   - `REJECTED`: không đồng ý đề xuất.
   - `DEFERRED`: để xử lý sau.

### AI diagnostics

1. Chọn provider/model.
2. Nhập API key.
3. Chọn action cần phân tích.
4. Chọn một hoặc nhiều playbook.
5. Bấm phân tích.
6. Đọc observations, hypotheses, suggested checks và limitations.

AI insight không thay đổi action deterministic.

### Runs & audit

Dùng để đối chiếu:

- Engine runs.
- Import history.
- QC status.
- Recommendation/action count.
- Append-only action log.

### Team

Chỉ Admin thấy:

- Nhập email nhân viên.
- Chọn project được phép thao tác.
- Mời user mới hoặc cập nhật assignment.

User được giao project có thể vận hành full workflow của project đó nhưng không xóa project người khác tạo.

### Sao lưu JSON

- Team workspace: Supabase là source of truth; JSON dùng làm bản sao kiểm tra/hỗ trợ debug.
- Browser workspace: có thể khôi phục bằng JSON.
- API key không được đưa vào JSON backup.
- Team JSON restore không phải database rollback và hiện không hiển thị.

---

## 15. Quy trình vận hành đề xuất

### Setup một brand mới

1. Admin tạo project.
2. Chọn KPI và target.
3. Định nghĩa Result/Qualified Result/Revenue.
4. Cấu hình window và context weights.
5. Kết nối raw Sheet.
6. Scan headers.
7. Map canonical fields.
8. Map supporting metrics/dimensions.
9. Chọn CBO/ABO.
10. Strict import.
11. Đối chiếu tổng Spend/Result với nguồn.
12. Review default rules.
13. Run engine.
14. Chọn 5–10 entity và tính tay.
15. Chỉ bắt đầu dùng Action Queue sau khi sample đã khớp.

### Workflow hằng ngày

1. Mở project.
2. Kiểm tra lần refresh cuối.
3. Refresh thủ công nếu connector chậm.
4. Xem QC.
5. Xem các nhóm Turn off/Invest/Keep/Review.
6. Mở evidence của entity cần hành động.
7. Xử lý theo Ad → Ad set → Campaign.
8. Mark status và note.
9. Dùng AI diagnostics cho case cần phân tích thêm.

### Khi đổi KPI/rule

1. Ghi lại lý do business.
2. Tăng `ruleVersion` khi thay đổi logic production có ý nghĩa.
3. Không sửa lịch sử run/action cũ.
4. Chạy lại cùng một `asOfDate` để so sánh.
5. Backtest trước nếu thay đổi lớn.

---

## 16. AI diagnostics và playbook

### Provider hỗ trợ

- OpenAI-compatible.
- OpenRouter hoặc endpoint OpenAI-compatible khác.
- Anthropic.
- Google Gemini.

Model ID và base URL có thể chỉnh trên UI.

### Built-in playbooks

| Playbook | Mục đích |
|---|---|
| Noti Meta performance diagnosis | Data quality, delivery mechanics, tracking và supporting metrics |
| Noti content, funnel & creative | Hypothesis TOFU/MOFU/BOFU và controlled creative test |
| Panasonic VN case guardrails | Checklist fragmentation, objective/goal và budget allocation; không copy benchmark case |

### Ranh giới AI

AI bắt buộc:

- Giữ nguyên deterministic recommendation làm context.
- Tách fact, hypothesis và check cần làm.
- Không bịa metric thiếu.
- Không tự gọi Ads API.
- Không khẳng định quan hệ nhân quả chỉ từ correlation.
- Khai báo limitations.

Output được validate theo schema:

```text
summary
observations[]
hypotheses[]
suggestedChecks[]
actionCommentary
confidence
limitations[]
```

---

## 17. Hướng dẫn tìm bug

### Thứ tự debug chuẩn

Không bắt đầu từ action cuối. Đi ngược theo pipeline:

```text
1. Auth/team permission
2. Project config
3. Source access
4. Raw rows
5. Mapping
6. Normalized FactRow
7. Import QC
8. Stored fact count
9. As-of date/freshness
10. Window totals
11. Metric formula
12. Achievement
13. Context score
14. Rule evidence
15. Threshold/priority
16. Guardrail
17. Action dedupe/state
18. AI diagnostics
```

### Debug health/backend

Mở:

```text
GET https://ads-optimization-app.vercel.app/api/health
```

Kỳ vọng:

```json
{
  "status": "ok",
  "supabaseTeamBackendConfigured": true
}
```

### Debug một entity cụ thể

Ghi lại:

```text
projectId
entityLevel
campaignId/adsetId/adId
asOfDate
primaryMetricKey
target
budgetType
status
ruleSetId/ruleVersion
```

Sau đó đối chiếu:

1. Tổng Spend/Result từng window.
2. KPI tính tay.
3. Achievement tính tay.
4. Window score.
5. Parent/project score.
6. Context-weighted score.
7. Rule có đủ evidence không.
8. Rule nào match.
9. Priority cao nhất.
10. Guardrail có đổi action không.

### Triệu chứng thường gặp

| Triệu chứng | Nguyên nhân cần kiểm tra |
|---|---|
| Project biến mất sau reload | Request save Supabase lỗi, auth/session hoặc project permission |
| Không kết nối được Sheet | Chưa share Viewer, sai tab, API chưa enable, credential Vercel sai |
| `413` khi import | Đang dùng version cũ/chưa batch upload hoặc payload có field quá lớn |
| Fact count đúng 1.000 | Version cũ hoặc pagination chưa chạy; hard refresh và kiểm tra deployment |
| Nhiều row lỗi phía cuối Sheet | Formula-only/padding rows, header anchor không nhận diện |
| KPI Today = N/A | As-of date không có row, denominator 0/null hoặc mapping Result sai |
| Tất cả Pending Data | Chưa đủ spend/result, Short required bị thiếu, score null hoặc target quá cao |
| `NO_RULES_CONFIGURED` | KPI/rule metric/version/level không khớp |
| `NO_RULE_MATCH` | Rule thresholds để hở khoảng |
| Không đề xuất budget | `budgetType = UNKNOWN/NONE`, sai CBO/ABO, entity inactive hoặc Ad level |
| Có decision nhưng Action Queue trống | Action là KEEP/PENDING hoặc actionKey đã tồn tại |
| QC stale dù vừa refresh | Kiểm tra deployment mới và mapping `sourceUpdatedAt` |
| Campaign/Ad set chỉ hiện ID | Chưa map `campaignName`/`adsetName` vào dimensions |
| Spend/Result tổng bị nhân | Import đồng thời nhiều entity levels hoặc duplicate grain |
| AI trả lỗi JSON | Provider/model không tuân schema, base URL/key sai |

### Bug report tối thiểu

Khi gửi bug, cung cấp:

- URL màn hình và tên project.
- Thời điểm xảy ra lỗi + timezone.
- Screenshot toàn màn hình.
- Nội dung toast/error code.
- Entity ID cụ thể.
- As-of date.
- KPI/target.
- Rule ID và version.
- Window metrics trong evidence drawer.
- Import/run record tương ứng.
- 3–10 raw rows mẫu đã xóa thông tin nhạy cảm.
- Expected result và actual result.
- Commit/deployment nếu biết.

Không gửi service-role key, Google private key hoặc AI API key.

### Cách xác nhận bug công thức

Một bug công thức chỉ được xác nhận khi:

1. Cùng raw rows.
2. Cùng mapping.
3. Cùng config/rule version.
4. Cùng asOfDate.
5. Tính tay cho kết quả khác engine.

Nếu một trong năm điều kiện khác nhau, đó có thể là thay đổi input chứ chưa chắc là bug engine.

---

## 18. Giới hạn hiện tại

- V1 không tự tắt/mở ads hoặc chỉnh budget qua Meta API.
- Auto refresh chỉ chạy khi có team workspace đang mở; chưa có background schedule 24/7.
- Google Sheets và stored fact reader giới hạn 20.000 rows/facts mỗi project run.
- Google sync đang upsert; row đã bị xóa khỏi Sheet không tự động bị xóa khỏi Supabase.
- Source grain mặc định không gồm breakdown dimensions; breakdown rows có thể tạo duplicate key.
- Action Queue chỉ tải một lượng lịch sử giới hạn cho UI.
- JSON restore trong Team workspace không phải database rollback.
- BigQuery connector chưa được implement.
- Rule Library Master dùng chung nhiều project và template migration tự động chưa được implement.
- AI phụ thuộc provider/key/model của người dùng và chỉ là advisory.

Với dữ liệu lớn hoặc yêu cầu chạy nền, hướng tiếp theo là:

```text
BigQuery raw/aggregate tables
  -> scheduled normalization
  -> Supabase canonical facts hoặc direct analytical query
  -> scheduled engine run
```

---

## 19. Phân quyền team

### Admin

- Xem tất cả project trong organization.
- Tạo project.
- Mời user.
- Gán project cho user.
- Chỉnh config/rules.
- Xóa project.

### User

- Xem project tự tạo hoặc được gán.
- Import/refresh data.
- Chỉnh config/rules trong project được giao.
- Run engine.
- Review Action Queue.
- Chỉ xóa project do chính user tạo.

Server kiểm tra permission trên mọi stored route. Việc ẩn button trên UI không được xem là security.

---

## 20. Development, deployment và kiểm thử

### Source of truth

| Logic | File |
|---|---|
| Fact/metric/rule schemas | `src/core/schemas.ts` |
| Metric formulas | `src/core/metrics.ts`, `src/core/library.ts` |
| Time windows/context | `src/core/windows.ts` |
| Rule matching/guardrails | `src/core/rules.ts` |
| QC | `src/core/qc.ts` |
| Action lifecycle/dedupe | `src/core/actions.ts` |
| Full engine pipeline | `src/core/engine.ts` |
| Default config/rules | `src/product/defaults.ts` |
| Google Sheets reader | `src/server/google-sheets.ts` |
| Supabase persistence/sync | `src/server/project-store.ts` |
| AI playbooks | `src/ai/playbooks.ts` |

UI không được định nghĩa lại formula khác với `src/core`.

### Local development

Yêu cầu Node.js 20+.

```bash
pnpm install
pnpm dev
```

### Environment variables

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_SERVICE_ACCOUNT_JSON
PROVIDER_KEY_ENCRYPTION_SECRET
NEXT_PUBLIC_APP_URL
CRON_SECRET
```

Chi tiết: [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md).

### Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

Nếu pnpm chặn build scripts:

```bash
pnpm approve-builds
```

Approve `esbuild` và `sharp`.

### Repository map

```text
src/
  ai/          provider adapters, contracts, playbooks
  app/         Next.js pages và API routes
  components/  operator UI
  core/        formulas, QC, rules, actions
  product/     workspace, persistence, defaults
  server/      Supabase, auth, Google Sheets, secrets
supabase/
  migrations/  PostgreSQL schema và RLS
docs/
  PRD.md
  ARCHITECTURE.md
  CORE_ENGINE.md
  API.md
  SUPABASE_SETUP.md
```

### API chính

```text
GET  /api/health
GET  /api/projects
POST /api/projects
GET  /api/projects/{projectId}/workspace
POST /api/projects/{projectId}/sources/google-sheets/preview
POST /api/projects/{projectId}/import
POST /api/projects/{projectId}/sync
POST /api/projects/{projectId}/run
GET  /api/projects/{projectId}/runs
GET  /api/projects/{projectId}/actions
PATCH /api/projects/{projectId}/actions/{actionId}
POST /api/ai/direct
POST /api/ai/analyze
```

Chi tiết contract: [`docs/API.md`](docs/API.md).

### Checklist trước khi release

- TypeScript pass.
- Unit/regression tests pass.
- Production build pass.
- `/api/health` trả `status: ok`.
- Supabase backend configured.
- Google Sheet preview hoạt động.
- Strict import sample khớp Spend/Result nguồn.
- Engine sample khớp tính tay.
- CBO/ABO guardrail đúng.
- Action transition và audit log đúng.
- Không có secret trong diff.
- Vercel Production alias đúng domain.

---

## Tài liệu liên quan

- [`docs/PRD.md`](docs/PRD.md) — phạm vi sản phẩm và acceptance criteria.
- [`docs/CORE_ENGINE.md`](docs/CORE_ENGINE.md) — specification công thức engine.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — boundary và trust model.
- [`docs/API.md`](docs/API.md) — API contracts.
- [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) — hướng dẫn backend/deployment.

Nếu README và code khác nhau, code trong `src/core` là runtime source of truth; hãy mở bug để cập nhật cả code, test và tài liệu trong cùng một thay đổi.
