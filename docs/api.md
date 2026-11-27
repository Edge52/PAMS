# Read-only API

PAMS has a small API so another system (a BI tool, a ministry dashboard) can read its data. It can only read.

## Tokens

An administrator makes a token under **Administration › API tokens** (`/admin/api`):

- **Name**: who uses it, e.g. "Power BI at head office".
- **May read** (scopes): `assets:read`, `workorders:read`, `ppm:read`, `analytics:read`. Add `prices:read` to include
  costs and prices; without it, money fields are left out.
- **Hospitals**: tick some to limit the token to them; tick none for every hospital.
- **Valid for**: 1 to 366 days.

The token (`hpk_…`) is shown once. PAMS keeps only its SHA-256, so a lost token can't be shown again: revoke it and
make a new one. Revoking takes effect at once.

## Calling it

Send the token in the `Authorization` header:

```
curl -H "Authorization: Bearer hpk_…" https://pams.hospital.example/api/v1/assets?perPage=100
```

The API never uses the browser's sign-in: a call without a token is refused even from a signed-in browser.

| Answer | Meaning |
| --- | --- |
| 200 | The data |
| 400 | A query parameter is wrong (the message says which) |
| 401 | No token, an unknown token, or one that has expired or been revoked |
| 403 | The token doesn't have the scope for this address |
| 429 | More than 60 calls in the last minute with this token: wait a minute (`Retry-After: 60`) |

Every call is logged (time, token, address, path, answer, rows) and the last 50 show on the tokens page.

## Paging

Lists answer one page at a time: `?page=1&perPage=50` (at most 200 a page).

```json
{ "data": [ … ], "page": 1, "perPage": 50, "total": 1234, "next": 2 }
```

`next` is null on the last page. Rows are in id order, so paging is stable while data is added.

## Addresses

All take `?facility=DGH,LPH` (hospital codes) to narrow to some of the token's hospitals.

| Address | Scope | Filters | Fields |
| --- | --- | --- | --- |
| `GET /api/v1/assets` | `assets:read` | `status` (IN_SERVICE, OUT_OF_SERVICE…), `updatedSince` (date or date-time) | id, tag, facility, deviceTypeCode, deviceType, manufacturer, model, serialNumber, udiDi, status, condition, criticality, department, room, purchaseDate, installDate, warrantyEnd, updatedAt; with `prices:read` also purchaseCost, currency |
| `GET /api/v1/work-orders` | `workorders:read` | `status`, `open=1` (not completed, closed or cancelled), `updatedSince` | id, number, facility, assetTag, type, priority, status, title, deviceDown, reportedAt, dueAt, startedAt, completedAt, closedAt, failureCode, coverage, laborHours, updatedAt; with `prices:read` also cost, currency |
| `GET /api/v1/ppm` | `ppm:read` | `status` (SCHEDULED, COMPLETED…), `from`, `to` (dates; the due date, or the done date when done) | id, facility, assetTag, type (PPM, CALIBRATION, INSPECTION, SAFETY_TEST), status, scheduledDate, completedDate, performedBy, downtimeHours; with `prices:read` also cost, currency |
| `GET /api/v1/analytics/kpis` | `analytics:read` | — | per hospital: devices, devicesDown, openWorkOrders, openWithDeviceDown, responseOverdue, ppmOverdue, ppmDone90d, ppmOnTimePct90d (done within 7 days of the due date) |

Times are UTC (ISO 8601); dates are `YYYY-MM-DD`. Money is a string with two decimals, in the row's currency.

## For developers

- Pure rules: `src/lib/api/tokens.ts` (token, bearer header, scopes, hospitals, paging, price hiding).
- Checks and log: `apiGet` in `src/lib/api/api-server.ts`; data in `src/lib/api/data-server.ts`; routes in
  `src/app/api/v1/**/route.ts`. `src/proxy.ts` lets `/api/v1` through without a session.
- Tables: `api_tokens`, `api_calls` (`src/db/schema-wave41-n.ts`).
- A new address: add a function to `data-server.ts` (bounded page, `inScope` on the hospital, money through
  `withoutPrices`), a route calling `apiGet(req, "<scope>", fn)`, and a row in the table above.
