User needs help with epic prioritization.

1. Explain MoSCoW Framework:
"I'll help you prioritize epics using the MoSCoW framework:
  Must Have: Critical for success, non-negotiable, highest business value
  Should Have: Important but not critical, can be deferred if necessary
  Could Have: Desirable but optional, nice-to-have
  Won't Have (this time): Not in scope for current release"

2. Offer WSJF Scoring (optional, more quantitative):
"For a more quantitative approach, I can calculate WSJF (Weighted Shortest Job
First) scores:
  WSJF = Cost of Delay / Job Size
  Cost of Delay = User-Business Value + Time Criticality + Risk/Opportunity
Would you like to use WSJF scoring?"

If yes to WSJF: For each epic, ask:
  "Rate User-Business Value (1–20, Fibonacci)"
  "Rate Time Criticality (1–20)"
  "Rate Risk/Opportunity (1–20)"
  "Rate Job Size (1–20)"

Calculate WSJF = (Value + Time + Risk) / Size
Sort epics by WSJF (highest first).

Present results with recommended MoSCoW mapping:
  Must Have: Epics with WSJF > 4.0
  Should Have: Epics with WSJF 2.5–4.0
  Could Have: Epics with WSJF < 2.5

Ask if the prioritization makes sense for their context.
