# Irrigation Schedule Optimization Report
## Loomis, California Property

---

### PHASE NOTE — Current Implementation

> **Phase 1 (current):** The schedule defined in this document is based entirely on historical irrigation practice and measured zone flow data. Zone timing is set manually in the Hydrawise controller and is not being adjusted dynamically by any software. Weather conditions, evapotranspiration rates, and plant/sod observations do not yet influence scheduling. This is the baseline from which a smart scheduling system (Phase 2) will eventually be built.

---

### CRITICAL OPERATIONAL NOTE — City Water Cutover

> ⚠️ **IMPORTANT:** During the spring window (March 15 – April 14), when ditch water is unavailable, city water **MUST be sourced from the barn location, NOT from the house.** This ensures the Garage flow meter captures accurate measurement data during city water season. Sourcing from the house bypasses the flow meter entirely and produces no usable data for spring irrigation analysis.

---

## Water Calendar

| Period | Dates | Water Source | Notes |
|--------|-------|--------------|-------|
| Spring irrigation window | Mar 15 – Apr 14 | City water (BARN LOCATION ONLY) | Sod zones at 67% of summer demand |
| Ditch water season | Apr 15 – Oct 15 | Ditch water → tank (4.29 GPM fill) | Full summer demand |
| Transition | May 15 | Switch to full summer schedule | |
| Off-season | Oct 16 – Mar 14 | No irrigation | |

---

## System Constants

| Parameter | Value |
|-----------|-------|
| Tank capacity | 1,725 gal |
| Usable capacity | 981 gal |
| Pump cutoff (dry-run sensor) | ~408 gal |
| Ditch fill rate | 4.29 GPM (257 GPH) |
| Fill availability | 24/7 during ditch season |
| Controllers | Garage, Pool Equipment |
| Programs per controller | 3 (A, B, C) |

---

## Zone Reference — Measured GPM

### Garage Controller

| Zone | Name | Type | GPM |
|------|------|------|-----|
| Z1 | Frontyard East Sod | Sod | 7.8 |
| Z2 | Frontyard West Sod | Sod | 14.4 |
| Z3 | Backyard East Sod | Sod | 10.8 |
| Z4 | Backyard West Sod | Sod | 7.6 |
| Z5 | Unused | — | — |
| Z6 | Frontyard Drip | Drip | 10.4 |
| Z7 | Backyard House Drip | Drip | 2.8 |
| Z8 | Garden Raised Beds & Trees | Drip | 3.0 |
| Z9 | Viewshed Hedges East Property Line | Drip | 4.0 |
| Z10–Z12 | Unused | — | — |

### Pool Equipment Controller

| Zone | Name | Type | GPM |
|------|------|------|-----|
| Z1 | Drip Around Pool | Drip | 1.7 |
| Z2 | Soccer Sod West South | Sod | 9.2 |
| Z3 | Soccer Sod West North | Sod | 7.0 |
| Z4 | Soccer Sod East South | Sod | 13.0 |
| Z5 | Soccer Sod East North | Sod | 9.5 |
| Z6 | Soccer Sod East North2 | Sod | 7.0 |
| Z7 | East Trees Sod South | Sod | 10.5 |
| Z8 | East Trees Sod North | Sod | 16.0 |
| Z9 | West Trees Sod Woodpile | Sod | 12.0 |
| Z10 | West Trees Sod Rocks | Sod | 11.0 |
| Z11 | West Trees Sod Septic | Sod | 10.0 |

---

## Optimization Strategy

### Problems with Current Schedule
- High-demand zones clustered into narrow time windows
- 7:45–8:35 AM Garage block drains 296 gal in 50 minutes
- 4:20–4:45 AM Pool Equipment soccer drains 112 gal
- Short fragmented sod runs (5 min) lead to evaporation loss before infiltration
- Tank minimum: 682 gal at 8:35 AM

### Optimization Principles
1. Spread sod demand across morning, evening, and night to flatten draw curve
2. Consolidate short sod runs into longer soakings (better infiltration, less evaporation)
3. Avoid sod watering 11 AM – 5 PM in summer (peak heat, evaporation loss)
4. Keep drip zones in stable mid-day slots (low GPM, minimal tank impact)
5. Use night and early morning hours for heaviest Pool Equipment zones
6. Fit all zones within three programs per controller with sequential zone scheduling

---

## Summer Schedule (April 15 – October 15)

**Total daily demand: 1,398.6 gal** (exactly matches original — same durations, timing only changed)
**Tank minimum: 780 gal at 9:29 PM** (80% of usable capacity)
**Safety margin above pump cutoff (408 gal): 372 gal**
**Pump risk: None**

> ℹ️ Zone durations are identical to the original schedule. Only the start times have been redistributed to spread demand across the day and keep the tank as full as possible.

### GARAGE CONTROLLER

**Program A — Early Morning Drips (Start: 3:00 AM)**
*Low-flow zones first, minimal tank impact, tank at full*

| Seq | Zone | Name | Start | Duration | GPM | Gallons |
|-----|------|------|-------|----------|-----|---------|
| 1 | Z7 | Backyard House Drip | 3:00 AM | 12 min | 2.8 | 33.6 |
| 2 | Z8 | Garden Raised Beds | 3:12 AM | 4 min | 3.0 | 12.0 |
| 3 | Z9 | Viewshed Hedges | 3:16 AM | 15 min | 4.0 | 60.0 |
| | | **Subtotal** | | **31 min** | | **105.6 gal** |

**Program B — Morning Sod (Start: 5:00 AM)**
*Cool temps, good infiltration, tank recovers all day*

| Seq | Zone | Name | Start | Duration | GPM | Gallons |
|-----|------|------|-------|----------|-----|---------|
| 1 | Z1 | Frontyard East Sod | 5:00 AM | 5 min | 7.8 | 39.0 |
| 2 | Z3 | Backyard East Sod | 5:05 AM | 5 min | 10.8 | 54.0 |
| 3 | Z4 | Backyard West Sod | 5:10 AM | 5 min | 7.6 | 38.0 |
| 4 | Z2 | Frontyard West Sod | 5:15 AM | 5 min | 14.4 | 72.0 |
| | | **Subtotal** | | **20 min** | | **203.0 gal** |

**Program C — Evening Drip (Start: 6:00 PM)**
*Moved out of morning to eliminate the biggest single drain event from AM hours*

| Seq | Zone | Name | Start | Duration | GPM | Gallons |
|-----|------|------|-------|----------|-----|---------|
| 1 | Z6 | Frontyard Drip | 6:00 PM | 30 min | 10.4 | 312.0 |
| | | **Subtotal** | | **30 min** | | **312.0 gal** |

**Garage Daily Total: 620.6 gal**

---

### POOL EQUIPMENT CONTROLLER

**Program A — Night Soccer Sod (Start: 11:00 PM)**
*Tank full going into this block, recovers overnight*

| Seq | Zone | Name | Start | Duration | GPM | Gallons |
|-----|------|------|-------|----------|-----|---------|
| 1 | Z2 | Soccer West South | 11:00 PM | 5 min | 9.2 | 46.0 |
| 2 | Z3 | Soccer West North | 11:05 PM | 5 min | 7.0 | 35.0 |
| 3 | Z4 | Soccer East South | 11:10 PM | 5 min | 13.0 | 65.0 |
| 4 | Z5 | Soccer East North | 11:15 PM | 5 min | 9.5 | 47.5 |
| 5 | Z6 | Soccer East North2 | 11:20 PM | 5 min | 7.0 | 35.0 |
| | | **Subtotal** | | **25 min** | | **228.5 gal** |

**Program B — Early Morning Drip + Trees (Start: 1:00 AM)**
*Tank recovering from soccer block, drip first to let it build back up*

| Seq | Zone | Name | Start | Duration | GPM | Gallons |
|-----|------|------|-------|----------|-----|---------|
| 1 | Z1 | Pool Drip | 1:00 AM | 20 min | 1.7 | 34.0 |
| 2 | Z7 | East Trees South | 1:20 AM | 7 min | 10.5 | 73.5 |
| 3 | Z8 | East Trees North | 1:27 AM | 7 min | 16.0 | 112.0 |
| | | **Subtotal** | | **34 min** | | **219.5 gal** |

**Program C — Late Night West Trees (Start: 9:00 PM)**
*Separated from soccer block by 2 hours so tank can partially recover between events*

| Seq | Zone | Name | Start | Duration | GPM | Gallons |
|-----|------|------|-------|----------|-----|---------|
| 1 | Z9 | West Trees Woodpile | 9:00 PM | 10 min | 12.0 | 120.0 |
| 2 | Z10 | West Trees Rocks | 9:10 PM | 10 min | 11.0 | 110.0 |
| 3 | Z11 | West Trees Septic | 9:20 PM | 10 min | 10.0 | 100.0 |
| | | **Subtotal** | | **30 min** | | **330.0 gal** |

**Pool Equipment Daily Total: 778.0 gal**

---

**Summer Grand Total: 1,398.6 gal/day ✓ (matches original exactly)**

### Tank Level Profile (Summer)

| Period | Tank Level | Notes |
|--------|------------|-------|
| Midnight | 981 gal (100%) | Full |
| 1:00 AM | 981 gal (100%) | Pool drip running |
| 1:27 AM | 860 gal (88%) | After East Trees |
| 5:00 AM | 981 gal (100%) | Recovered to full |
| 5:20 AM | 868 gal (89%) | After Garage sod |
| 6:00 AM–6:00 PM | 981 gal (100%) | Fully recovered, holds all day |
| 6:30 PM | 802 gal (82%) | After Frontyard Drip |
| 7:00 PM | 981 gal (100%) | Recovered to full |
| 9:30 PM | 780 gal (80%) | **Daily minimum — after West Trees** |
| 10:00 PM | 981 gal (100%) | Recovered to full |
| 11:25 PM | 864 gal (88%) | After Soccer block |
| Midnight | ~950 gal | Still recovering |

---

## Spring Schedule (March 15 – May 15)

**Drip zones:** Unchanged from summer (same durations)
**Sod zones:** 67% of summer duration
**Total daily demand: ~1,025 gal**
**Tank minimum: ~850 gal (87% of usable capacity)**

### GARAGE CONTROLLER

**Program A — Early Morning Drips (Start: 3:00 AM)**
*(Identical to summer)*

| Seq | Zone | Name | Duration | GPM | Gallons |
|-----|------|------|----------|-----|---------|
| 1 | Z7 | Backyard House Drip | 12 min | 2.8 | 33.6 |
| 2 | Z8 | Garden Raised Beds | 4 min | 3.0 | 12.0 |
| 3 | Z9 | Viewshed Hedges | 15 min | 4.0 | 60.0 |
| | | **Subtotal** | **31 min** | | **105.6 gal** |

**Program B — Morning Sod (Start: 5:00 AM)**
*(Sod durations × 0.67, rounded to nearest minute)*

| Seq | Zone | Name | Duration | GPM | Gallons |
|-----|------|------|----------|-----|---------|
| 1 | Z1 | Frontyard East Sod | 3 min | 7.8 | 23.4 |
| 2 | Z3 | Backyard East Sod | 3 min | 10.8 | 32.4 |
| 3 | Z4 | Backyard West Sod | 3 min | 7.6 | 22.8 |
| 4 | Z2 | Frontyard West Sod | 3 min | 14.4 | 43.2 |
| | | **Subtotal** | **12 min** | | **121.8 gal** |

**Program C — Evening Drip (Start: 6:00 PM)**
*(Identical to summer)*

| Seq | Zone | Name | Duration | GPM | Gallons |
|-----|------|------|----------|-----|---------|
| 1 | Z6 | Frontyard Drip | 30 min | 10.4 | 312.0 |
| | | **Subtotal** | **30 min** | | **312.0 gal** |

**Garage Spring Total: 539.4 gal**

---

### POOL EQUIPMENT CONTROLLER

**Program A — Night Soccer Sod (Start: 11:00 PM)**
*(Sod durations × 0.67)*

| Seq | Zone | Name | Duration | GPM | Gallons |
|-----|------|------|----------|-----|---------|
| 1 | Z2 | Soccer West South | 3 min | 9.2 | 27.6 |
| 2 | Z3 | Soccer West North | 3 min | 7.0 | 21.0 |
| 3 | Z4 | Soccer East South | 3 min | 13.0 | 39.0 |
| 4 | Z5 | Soccer East North | 3 min | 9.5 | 28.5 |
| 5 | Z6 | Soccer East North2 | 3 min | 7.0 | 21.0 |
| | | **Subtotal** | **15 min** | | **137.1 gal** |

**Program B — Early Morning Drip + Trees (Start: 1:00 AM)**
*(Drip unchanged, sod × 0.67)*

| Seq | Zone | Name | Duration | GPM | Gallons |
|-----|------|------|----------|-----|---------|
| 1 | Z1 | Pool Drip | 20 min | 1.7 | 34.0 |
| 2 | Z7 | East Trees South | 5 min | 10.5 | 52.5 |
| 3 | Z8 | East Trees North | 5 min | 16.0 | 80.0 |
| | | **Subtotal** | **30 min** | | **166.5 gal** |

**Program C — Late Night West Trees (Start: 9:00 PM)**
*(Sod durations × 0.67)*

| Seq | Zone | Name | Duration | GPM | Gallons |
|-----|------|------|----------|-----|---------|
| 1 | Z9 | West Trees Woodpile | 7 min | 12.0 | 84.0 |
| 2 | Z10 | West Trees Rocks | 7 min | 11.0 | 77.0 |
| 3 | Z11 | West Trees Septic | 7 min | 10.0 | 70.0 |
| | | **Subtotal** | **21 min** | | **231.0 gal** |

**Pool Equipment Spring Total: 534.6 gal**

---

**Spring Grand Total: 1,074.0 gal/day**

---

## To Do Before Implementing

- [ ] Cutover city water from barn location (not house) before spring irrigation begins
- [ ] Repair/clean Garage flow meter paddlewheel — currently intermittent on sod zones
- [ ] Walk Garage Z6 Frontyard Drip while running — confirm zone type (spray vs drip) and verify 10.4 GPM
- [ ] Walk Garage Z2 Frontyard West Sod while running — 14.4 GPM unusually high, verify head count
- [ ] Capture Barn controller zone data (GPM and current schedule screenshots)
- [ ] Test new schedule on Pool Equipment controller first (flow meter working, easier to verify)
- [ ] Monitor tank level daily for first two weeks after schedule change
- [ ] Log minimum daily tank level — target no lower than 750 gal in summer

---

*Generated from Hydrawise flow meter data and tank simulation modeling.*
*Last updated: April 2026*
