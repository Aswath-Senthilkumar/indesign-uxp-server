# render-service/bov

BOV (Broker Opinion of Value) workflow. Each BOV is a multi-section, multi-page document built across 7 steps in the dashboard. Each section renders independently to PDF; the dashboard merges them for preview.

## Status

| Section | Route | Status |
|---------|-------|--------|
| Cover | `POST /bov/cover/render` | Complete |
| Section 1 (Similar Transactions + Exec Summary + Pricing) | `POST /bov/section1/render` | Complete |
| Section 2 | `POST /bov/section2/render` | Pending |
| Sections 3 – 7 | — | Pending |

## Structure

```
bov/
├── index.js          Express sub-router — mounts all /bov/* routes
└── routes/
    ├── cover.js      Cover page renderer
    └── section1.js   Section 1 renderer (3 pages)
```

## Routes

### `POST /bov/cover/render`

Renders the BOV cover page. Accepts `multipart/form-data`.

**Form fields:**

| Field | Type | Description |
|-------|------|-------------|
| `client_name` | text | Client name shown on cover |
| `client_property_address` | text | Subject property address |
| `property_type` | text | e.g. "Industrial" |
| `broker_name` | text | Broker's name |
| `date` | text | Report date |
| `cover_image` | file | Cover photo (uploaded) |
| `cover_image_url` | text | Supabase URL (alternative to file upload) |

**Response:** `application/pdf`

---

### `POST /bov/section1/render`

Renders Section 1 — three pages:
1. **Similar Transactions** — 6 comp tiles with address, SF/AC, photo
2. **Executive Summary** — client mention, property highlights, strengths & opportunities
3. **Pricing Recommendations** — asking/expected price, marketing time, pricing paragraph, conclusion

Accepts `multipart/form-data`.

**Form fields:**

| Field | Notes |
|-------|-------|
| `tile_{1–6}_address_status` | e.g. `2847 E Jones Ave \| Sold` |
| `tile_{1–6}_sf_on_ac` | e.g. `±14,350 SF on ±1.88 AC` |
| `tile_{1–6}_image` | File upload (takes priority over URL) |
| `tile_{1–6}_image_url` | Supabase public URL (staged to disk before bridge call) |
| `similar_transactions_address` | Replaces placeholder in intro paragraph |
| `client_mention` | Name only — sentence is static in template; name rendered in pink |
| `property_highlights_json` | JSON array of `{key, value}` pairs (up to 6 rows) |
| `strengths_opportunities` | Newline-separated bullet points; auto-period added per line |
| `asking_sales_price` | e.g. `$2,800,000` |
| `expected_sales_price` | e.g. `$2,500,000 – $2,800,000` |
| `projected_marketing_time` | Value only — "Projected Marketing Time:" label is static in template |
| `pricing_paragraph` | Free-form paragraph |
| `conclusion_paragraph` | Free-form multi-paragraph text; blank lines collapse to single paragraph break |

**Response:** `application/pdf`

---

## Section 1 — InDesign frame names

| Frame | Page | Notes |
|-------|------|-------|
| `tile_{N}_address \| status` | 1 | N = 1–6 |
| `tile_{N}_sf_on_ac` | 1 | N = 1–6 |
| `tile_{N}_photo` | 1 | N = 1–6, rectangle frame |
| `similar_transactions_intro_paragraph` | 1 | Address replaced in-place |
| `client_mention` | 2 | Full sentence; name portion replaced in-place, pink style preserved |
| `property_highlights_labels` | 2 | Multi-line frame, `\r`-joined keys |
| `property_highlights_values` | 2 | Multi-line frame, `\r`-joined values |
| `property_assessment_strengths_opportunities_points` | 2 | `\r`-joined bullet points |
| `asking_sales_price` | 3 | |
| `expected_sales_price` | 3 | |
| `projected_marketing_time` | 3 | In-place replacement after "Projected Marketing Time:" |
| `pricing_paragraph` | 3 | |
| `conclusion_paragraph` | 3 | |

## Bridge code patterns established in Section 1

These patterns apply to all future BOV sections:

**Multi-line frame:** use `tf.contents = array.join('\\r')`. Do NOT use paragraph-by-paragraph iteration — setting `para.contents` without a trailing `\r` strips the paragraph mark and merges lines.

**In-place text replacement (preserves character styles):** search the frame's `.contents` string for a known marker, then use `tf.characters.itemByRange(start, end).contents = newText`. Never use `tf.contents = newText` when pink/styled text must be preserved.

**Character scan (avoid string-index mismatch):** when the replacement target is a named value (e.g. client name) in a sentence, scan `tf.characters` directly character-by-character instead of using `String.indexOf` — InDesign's internal character indices can diverge from JS string positions due to smart-quote conversion.

**Line ending normalisation:** always normalise incoming text with `.replace(/\\r\\n/g, '\\r').replace(/\\n/g, '\\r').replace(/\\r\\r+/g, '\\r')` before setting frame contents to prevent double paragraph marks from Windows CRLF or blank lines.

**Image staging:** images from Supabase URLs are downloaded and written to `output/` before the bridge call, then cleaned up in the `finally` block. File uploads and URL staging produce the same `imagePath` string handed to the bridge.

**Never use `$.writeln`:** that is ExtendScript API, not available in UXP. Use `console.log` for bridge-side debug output.

## Adding a new section

1. Create `render-service/bov/routes/section{N}.js`
2. Define the route + `buildBridgeCode()` following `section1.js` as a template
3. Mount the route in `render-service/bov/index.js`
4. Create `dashboard/app/api/bov/section{N}/render/route.ts` (Next.js proxy)
5. Create `dashboard/components/bov-section{N}-step.tsx` (step UI)
6. Register the step in `dashboard/lib/bov-steps.ts`
