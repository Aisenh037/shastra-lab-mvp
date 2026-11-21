# Rubrics

One JSON file per question. The evaluator uses a rubric only when `"status": "reviewed"`; until then it falls back to the question's key points and tells the user so.

## Workflow

1. **Draft:** paste the prompt below into any LLM, with the question, marks and word limit. Save the JSON as `rubrics/<paper>-<slug>.json`.
2. **Review:** a mains-qualified mentor edits the points: removes padding, adds what toppers write, marks the 3-5 points an examiner would expect as `mustHave`. Then set `"status": "reviewed"`, `"source": "reviewed"` and `"reviewedBy": "<name>"`.
3. **Check:** `npm run rubrics:validate`
4. **Load:** `npm run rubrics:sql > /tmp/rubrics.sql`, then paste it into the Supabase SQL editor. Safe to re-run; it updates existing rubrics.

Questions are matched by exact `match.questionText` among the PYQ template questions.

## Format

```json
{
  "match": { "questionText": "Exact question text as stored" },
  "status": "draft",
  "reviewedBy": null,
  "rubric": {
    "version": 1,
    "directive": "discuss",
    "paper": "GS3",
    "maxMarks": 15,
    "wordLimit": 250,
    "source": "draft",
    "dimensions": [
      { "id": "economic", "label": "Economic", "points": [
        { "id": "eco-1", "text": "A checkable statement of one expected idea", "mustHave": true }
      ] }
    ]
  }
}
```

- `directive`: `discuss`, `critically_examine`, `critically_analyse`, `analyse`, `examine`, `explain`, `evaluate`, `comment`, `elucidate`, `enumerate`, `justify`, `describe` or `other`.
- **Dimension labels recur across questions** ("Economic", "Ethical", "Way forward"). Reuse the same labels so weakness tracking can spot "you often miss the ethical dimension".
- Write each point as one idea an examiner could tick, not a topic heading. "Delayed payments strain MSME working capital" is a point; "MSME issues" isn't.
- 6-15 points per question. Must-have points count double.

## How marks are computed

The model never gives a score. It reports which points the answer covers, quoting the answer as evidence, and rates six presentation criteria from 1 to 5. The code then:

- discards any coverage claim whose quote isn't in the answer
- gives **60% of marks for content**: weighted coverage of the points (full = 1, partial = 0.5)
- gives **40% for presentation**: introduction 15%, structure 20%, answering the directive 25%, conclusion 15%, examples 15%, language 10%. This can't exceed twice the content coverage, so a polished answer that says little scores low.
- deducts 10% of marks for answers more than 20% over the word limit, and rounds to half marks

The split lives in `supabase/functions/_shared/scoring.ts`. Change it only with calibration data behind the change.

## Drafting prompt

```
You are drafting a marking rubric for a UPSC Mains question. A mentor who cleared mains will review it.

Question: <question>
Paper: <GS1|GS2|GS3|GS4|Essay>   Marks: <10|15>   Word limit: <150|250>

Return JSON only, in this shape:
{"version":1,"directive":"<discuss|critically_examine|critically_analyse|analyse|examine|explain|evaluate|comment|elucidate|enumerate|justify|describe|other>","paper":"<paper>","maxMarks":<marks>,"wordLimit":<limit>,"source":"draft","dimensions":[{"id":"<lowercase-id>","label":"<Title Case>","points":[{"id":"<dim>-<n>","text":"<one checkable expected idea>","mustHave":<true|false>}]}]}

Rules:
- Dimensions are the angles an examiner expects (Context, Economic, Social, Political, Ethical, Environmental, Constitutional, Policy, Way forward). Use only the ones this question needs, 3-5 of them.
- Start with a Context dimension (definition or significance) and end with Way forward or a conclusion where the directive needs one.
- 6-15 points in total. Each is one specific idea a good answer contains: a scheme, an article, a report, a mechanism, a trade-off. No vague headings.
- Mark 3-5 points mustHave: the ones whose absence an examiner would notice first.
- For "critically" directives include at least one point on limitations and one requiring a judgement.
- Do not invent statistics. If a figure matters, write the point so it asks for "a relevant figure on X".
```
