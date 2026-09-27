---
name: matchmaker-ui
description: Visual language for the Pittsburgh typology Streamlit app. Use when restyling app.py, Streamlit theme, or CSS. Inspired by Cluely.com and Leonxlnx taste-skill (soft + redesign).
---

# Matchmaker UI

Reading this as: public-sector housing decision support for a CDC and hackathon judges, with a Cluely-like editorial language (serif display, sky wash, pill buttons, glass overlays), leaning toward Streamlit CSS overrides rather than a React rewrite.

Dials: DESIGN_VARIANCE 5, MOTION_INTENSITY 3, VISUAL_DENSITY 5.

## Do

- Display type: EB Garamond. UI type: Geist or Outfit. Never Inter/Roboto.
- Sky-to-cream wash like Cluely hero. One accent: muted indigo `#4C6FFF`. No purple AI mesh.
- Eyebrow pills, sentence-case headlines, tabular numbers.
- Nested glass cards (outer pad + inner surface). Pill primary buttons.
- Hide Streamlit Deploy chrome, hamburger, footer.
- Keep missing-data labels honest. No fake scores.

## Do not

- Three equal Bootstrap feature cards as the hero.
- Em dashes in UI copy.
- GSAP/React migration. Stay on Streamlit.
- Break scoring.py or sites.csv.
