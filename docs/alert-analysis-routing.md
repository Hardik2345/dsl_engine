# Alert Analysis Routing

This document explains how the alert workflow engine chooses the SQL path for dimension breakdowns, what the source of truth is for each path, and what constraints apply.

## Purpose

The engine supports multiple analysis paths because not every dimension has the same data available at every time grain. In practice, the query builder routes breakdowns into one of three behaviors:

1. Partial-day `product_id` analysis
2. Partial-day `landing_page_path` analysis
3. Default daily analysis for all other cases

The routing lives in [`sql/templates/dimensionBreakdownQuery.js`](/Users/hardik/Projects/dsl_engine/sql/templates/dimensionBreakdownQuery.js).

## Routing Summary

The engine chooses the path in this order:

1. If `dimension === 'product_id'` and either the analysis window or baseline window is partial-day, use the hourly product rollup path.
2. Else if `dimension === 'landing_page_path'` and either the analysis window or baseline window is partial-day, use the hourly landing-page attribution path.
3. Else use the default daily path.

The main routing helpers are:

- [`shouldUseHourlyProductRollup(...)`](/Users/hardik/Projects/dsl_engine/sql/templates/dimensionBreakdownQuery.js)
- [`shouldUseHourlyLandingPagePathAttribution(...)`](/Users/hardik/Projects/dsl_engine/sql/templates/dimensionBreakdownQuery.js)

Window normalization and partial-day detection live in:

- [`lib/timeWindowUtils.js`](/Users/hardik/Projects/dsl_engine/lib/timeWindowUtils.js)

## Behavior 1: Partial-Day `product_id`

### When it is used

- The active breakdown dimension is `product_id`
- The analysis or baseline window is not full-day aligned

### Source of truth

- Sessions: `hourly_product_performance_rollup`
- ATC sessions: `hourly_product_performance_rollup`
- Orders: `hourly_product_performance_rollup`
- Product title: `hourly_product_performance_rollup`

This path is the closest thing to a direct hourly source of truth for product analysis in the engine today.

### Why this exists

The daily snapshot tables are not suitable for true partial-day product analysis. The hourly rollup already has product-level sessions and orders, so the engine can compute partial-day product metrics directly.

### Metrics produced

- `current_sessions`, `baseline_sessions`
- `current_atc_sessions`, `baseline_atc_sessions`
- `current_orders`, `baseline_orders`
- Derived downstream: CVR, ATC rate, deltas, ranking

### Constraints

This path only supports `product_id` filters safely.

Unsupported filter dimensions are rejected by:

- [`listHourlyProductUnsupportedFilters(...)`](/Users/hardik/Projects/dsl_engine/lib/timeWindowUtils.js)
- [`validateRunContextAgainstWorkflow(...)`](/Users/hardik/Projects/dsl_engine/server/validation/productPartialDayCompatibility.js)

This also means recursive partial-day workflows cannot place `product_id` after unsupported dimensions such as UTM dimensions.

## Behavior 2: Partial-Day `landing_page_path`

### When it is used

- The active breakdown dimension is `landing_page_path`
- The analysis or baseline window is not full-day aligned

### Source of truth

- Sessions: `hourly_product_sessions`
- ATC sessions: `hourly_product_sessions`
- Orders: `shopify_orders`
- Join key between session-side and order-side data: `product_id`

### Why this exists

`hourly_product_performance_rollup` does not contain `landing_page_path`, so true hourly landing-page analysis cannot come from that table. The only hourly source with landing-page granularity is `hourly_product_sessions`.

### How orders are handled

Orders are not directly stored at hourly `landing_page_path` granularity. Because of that, this path uses CTE-based proportional attribution:

1. Aggregate sessions by `(landing_page_path, product_id)` for current and baseline windows
2. Aggregate product-level orders from `shopify_orders`
3. Compute each landing path's share of a product's sessions
4. Allocate that product's orders to landing paths using the session share
5. Sum allocated orders back to `landing_page_path`

This is implemented in the hourly landing-page branch in:

- [`sql/templates/dimensionBreakdownQuery.js`](/Users/hardik/Projects/dsl_engine/sql/templates/dimensionBreakdownQuery.js)

### Metrics produced

- `current_sessions`, `baseline_sessions`
- `current_atc_sessions`, `baseline_atc_sessions`
- `current_orders`, `baseline_orders` as allocated order totals
- Derived downstream: CVR, ATC rate, deltas, ranking

### Important semantic caveat

This is modeled attribution, not transaction-exact landing-page order attribution.

The numbers are analytically useful and internally consistent, but they are not the same as having path-level order attribution stored on the order itself.

### Constraints

This path currently only supports `product_id` filters safely.

Unsupported filter dimensions are rejected by:

- [`listHourlyLandingPagePathUnsupportedFilters(...)`](/Users/hardik/Projects/dsl_engine/lib/timeWindowUtils.js)
- [`validateRunContextAgainstWorkflow(...)`](/Users/hardik/Projects/dsl_engine/server/validation/productPartialDayCompatibility.js)

Recursive partial-day workflows also cannot place `landing_page_path` after unsupported dimensions. The only allowed preceding dimension is `product_id`.

Examples of unsupported partial-day landing-page flows:

- `utm_source -> landing_page_path`
- `utm_campaign -> landing_page_path`
- `referrer_name -> landing_page_path`

Allowed example:

- `product_id -> landing_page_path`

## Behavior 3: Default Daily Path

### When it is used

This is the fallback for:

- Full-day aligned windows
- Non-hourly dimensions
- Any dimension not covered by the two special partial-day branches

### Source of truth

- Sessions: `product_sessions_snapshot`
- ATC sessions: `product_sessions_snapshot`
- Orders: `shopify_orders`
- Product title, when relevant: `product_sessions_snapshot`

### Why this exists

This is the original, general-purpose breakdown path. It works for daily analysis across supported dimensions such as:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `landing_page_path`
- `landing_page_type`
- `referrer_name`
- `product_id`

### Metrics produced

- `current_sessions`, `baseline_sessions`
- `current_atc_sessions`, `baseline_atc_sessions`
- `current_orders`, `baseline_orders`
- Derived downstream: CVR, ATC rate, deltas, ranking

### Semantics

This path behaves like the canonical daily breakdown logic in the engine. When the windows are full-day aligned, this is the path that should be treated as the default reference behavior.

## What the Node Expects

Regardless of routing path, the breakdown query must return the same output contract so that [`RecursiveDimensionBreakdownNode.js`](/Users/hardik/Projects/dsl_engine/nodes/RecursiveDimensionBreakdownNode.js) can continue operating without path-specific logic.

Expected columns:

- `dimension_value`
- `current_sessions`
- `baseline_sessions`
- `current_atc_sessions`
- `baseline_atc_sessions`
- `current_orders`
- `baseline_orders`
- `product_title` only when relevant for `product_id`

The node then computes:

- CVR
- ATC rate
- Delta percentages
- candidate filtering
- ranking
- top-k selection

## Validation and Guardrails

There are two kinds of guardrails:

1. Query-time guardrails in the query builder
2. Workflow/run-time guardrails in validation

### Query-time guardrails

These reject unsupported filters before generating unsafe hourly SQL:

- [`buildHourlyProductFilterWhere(...)`](/Users/hardik/Projects/dsl_engine/sql/templates/dimensionBreakdownQuery.js)
- [`buildHourlyLandingPagePathFilterWhere(...)`](/Users/hardik/Projects/dsl_engine/sql/templates/dimensionBreakdownQuery.js)

### Workflow/run-time guardrails

These reject workflows or run contexts that would route into unsupported hourly combinations:

- [`getPartialDayProductCompatibilityErrors(...)`](/Users/hardik/Projects/dsl_engine/server/validation/productPartialDayCompatibility.js)
- [`getPartialDayLandingPagePathCompatibilityErrors(...)`](/Users/hardik/Projects/dsl_engine/server/validation/productPartialDayCompatibility.js)
- [`validateRunContextAgainstWorkflow(...)`](/Users/hardik/Projects/dsl_engine/server/validation/productPartialDayCompatibility.js)

UI-side warnings mirror the same logic in:

- [`ui/src/utils/workflowValidation.js`](/Users/hardik/Projects/dsl_engine/ui/src/utils/workflowValidation.js)
- [`ui/src/components/RunWorkflowModal.jsx`](/Users/hardik/Projects/dsl_engine/ui/src/components/RunWorkflowModal.jsx)

## Practical Reading Guide

If you are debugging which path a workflow run took, read in this order:

1. [`nodes/RecursiveDimensionBreakdownNode.js`](/Users/hardik/Projects/dsl_engine/nodes/RecursiveDimensionBreakdownNode.js)
2. [`sql/QueryBuilder.js`](/Users/hardik/Projects/dsl_engine/sql/QueryBuilder.js)
3. [`sql/templates/dimensionBreakdownQuery.js`](/Users/hardik/Projects/dsl_engine/sql/templates/dimensionBreakdownQuery.js)
4. [`lib/timeWindowUtils.js`](/Users/hardik/Projects/dsl_engine/lib/timeWindowUtils.js)
5. [`server/validation/productPartialDayCompatibility.js`](/Users/hardik/Projects/dsl_engine/server/validation/productPartialDayCompatibility.js)

## Current Design Position

The engine now has three clear routing behaviors:

1. Direct hourly product rollup
2. Hourly landing-page analysis with proportional order attribution
3. Default daily breakdown

This keeps the runtime contract stable while making the source-of-truth differences explicit instead of implicit.
