# Capability Examples

Reference examples for Claude Code when building the server's capability 
validation logic and for testing.

These cover different service types, pricing models, and service areas.

---

## Example 1 — Domestic Cleaning (fixed price, card only)

```yaml
- capability_id: domestic_oven_clean_v1
  name: Oven Cleaning
  description: Professional domestic oven cleaning including racks and glass
  version: 1.0.0
  service_area:
    country: GB
    regions: [M, SK, OL, WA, BL, WN]
  inputs:
    postcode:
      type: string
      required: true
      description: Full UK postcode
    oven_type:
      type: string
      required: false
      enum: [single, double, range, aga]
    preferred_date:
      type: date
      required: false
  outputs:
    confirmed_time:
      type: datetime
    price_gbp:
      type: number
    technician_name:
      type: string
  payment_options:
    - rail: stripe_card
      currency: GBP
      pricing_model: quote_then_accept
  sla:
    quote_within_minutes: 60
    complete_within_hours: 120
  cancellation: Full refund if cancelled more than 24 hours before appointment
  dispute:
    contact_email: bookings@sparkleoven.co.uk
    contact_phone: "+441619871234"
    resolution_window_hours: 48
```

---

## Example 2 — Plumbing (quote model, card + USDC)

```yaml
- capability_id: emergency_plumbing_v1
  name: Emergency Plumbing
  description: Emergency callout for leaks, burst pipes, boiler issues
  version: 1.0.0
  service_area:
    country: GB
    regions: [M, SK, OL, WA, BL, WN, HD, HX]
  inputs:
    postcode:
      type: string
      required: true
    issue_type:
      type: string
      required: true
      enum: [leak, burst_pipe, boiler, blockage, other]
    urgency:
      type: string
      required: true
      enum: [emergency_1hr, same_day, next_day]
    description:
      type: string
      required: false
      description: Brief description of the problem
  outputs:
    estimated_arrival:
      type: datetime
    quote_range_gbp_min:
      type: number
    quote_range_gbp_max:
      type: number
    engineer_name:
      type: string
    engineer_phone:
      type: string
  payment_options:
    - rail: stripe_card
      currency: GBP
      pricing_model: quote_then_accept
    - rail: usdc_base
      currency: USDC
      chain: base
      pricing_model: prepay
  sla:
    quote_within_minutes: 15
    complete_within_hours: 24
  cancellation: No charge if cancelled before engineer dispatched
  dispute:
    contact_email: support@davesplumbing.co.uk
    contact_phone: "+441619876543"
    resolution_window_hours: 72
```

---

## Example 3 — Car Valeting (prepay, city-based service area)

```yaml
- capability_id: mobile_car_valet_full_v1
  name: Full Mobile Car Valet
  description: Full interior and exterior valet at your location
  version: 1.0.0
  service_area:
    country: GB
    cities: [Manchester, Salford, Trafford, Stockport]
  inputs:
    postcode:
      type: string
      required: true
    vehicle_size:
      type: string
      required: true
      enum: [hatchback, saloon, estate, suv, van]
    preferred_date:
      type: date
      required: false
    preferred_time:
      type: string
      required: false
      enum: [morning, afternoon, evening]
  outputs:
    confirmed_datetime:
      type: datetime
    price_gbp:
      type: number
    duration_hours:
      type: number
  payment_options:
    - rail: stripe_card
      currency: GBP
      pricing_model: fixed
    - rail: usdc_base
      currency: USDC
      chain: base
      pricing_model: prepay
  sla:
    quote_within_minutes: 30
    complete_within_hours: 72
  cancellation: 50% refund if cancelled within 12 hours of booking
  dispute:
    contact_email: info@mcrvaleting.co.uk
    contact_phone: "+447700900123"
    resolution_window_hours: 48
```

---

## Example 4 — Document Delivery (radius-based, same day)

```yaml
- capability_id: same_day_document_delivery_v1
  name: Same-Day Document Delivery
  description: Hand-delivered document or small package, same day
  version: 1.0.0
  service_area:
    country: GB
    regions: [M]
    radius_km: 20
  inputs:
    pickup_postcode:
      type: string
      required: true
    delivery_postcode:
      type: string
      required: true
    item_description:
      type: string
      required: true
    recipient_name:
      type: string
      required: true
    recipient_phone:
      type: string
      required: false
  outputs:
    tracking_reference:
      type: string
    estimated_delivery:
      type: datetime
    driver_name:
      type: string
    driver_phone:
      type: string
  payment_options:
    - rail: stripe_card
      currency: GBP
      pricing_model: fixed
    - rail: usdc_base
      currency: USDC
      chain: base
      pricing_model: prepay
  sla:
    quote_within_minutes: 5
    complete_within_hours: 8
  cancellation: Full refund if cancelled before driver dispatched
  dispute:
    contact_email: ops@manchestercouriers.co.uk
    contact_phone: "+441619990000"
    resolution_window_hours: 24
```

---

## Validation Rules (for server capability schema validator)

When a business pushes capabilities.yaml, validate:

```typescript
const rules = {
  capability_id: /^[a-z0-9_]+_v\d+$/,  // must end in _v[number]
  version: /^\d+\.\d+\.\d+$/,           // semver
  service_area: {
    country: /^[A-Z]{2}$/,              // ISO 3166-1
    regions: 'array of 1-4 char strings',
    // at least one of regions, cities, or radius_km must be present
  },
  inputs: {
    // at least one input field required
    // each field must have type and required
    // enum only valid on string type
  },
  outputs: {
    // at least one output field required
  },
  payment_options: {
    // at least one required
    // if usdc_base, chain must be "base"
  },
  sla: {
    quote_within_minutes: 'positive integer',
    complete_within_hours: 'positive integer',
  },
  dispute: {
    contact_email: 'valid email format',
    resolution_window_hours: 'positive integer',
  }
}
```

---

## Test Inputs for Integration Testing

```typescript
// Valid task submission for oven_clean
const validOvenCleanTask = {
  capability_id: "domestic_oven_clean_v1",
  inputs: {
    postcode: "M1 2AB",
    oven_type: "double",
    preferred_date: "2026-03-25"
  },
  payment_rail: "stripe_card"
}

// Valid task submission for emergency plumbing
const validPlumbingTask = {
  capability_id: "emergency_plumbing_v1", 
  inputs: {
    postcode: "SK1 1AA",
    issue_type: "boiler",
    urgency: "same_day",
    description: "Boiler not firing, no hot water"
  },
  payment_rail: "usdc_base"
}

// Invalid — missing required field
const invalidTask = {
  capability_id: "domestic_oven_clean_v1",
  inputs: {
    oven_type: "double"
    // missing required postcode
  }
}

// Invalid — wrong enum value
const invalidEnumTask = {
  capability_id: "domestic_oven_clean_v1",
  inputs: {
    postcode: "M1 2AB",
    oven_type: "microwave"  // not in enum
  }
}
```
