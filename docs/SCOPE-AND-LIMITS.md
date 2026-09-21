# Scope and limits

This document exists because the brief for this project had two halves. One half
is built and shipped. The other half should not be built by anyone, and this
explains why, with enough specifics that you can check the reasoning yourself.

## What is built

A demo that runs in your browser and, for each face it finds in a webcam feed or
a video clip, reports:

- a bounding box and detection confidence,
- an **apparent age** estimate, shown as a range,
- a distribution over **seven facial expression classes**.

Nothing is uploaded, recorded, or stored. Analysis of uploaded clips happens
locally through the same pipeline.

## What is not built, and will not be

The brief also described using this to analyse traffic-camera footage in order to
detect child traffickers, pickpockets, and "criminal activity planned in the
road." That layer is absent, and its absence is enforced in the code: the
identity-embedding model is not in this repository, so the app cannot recognise
or re-identify anyone, and it does not track faces between frames.

Three independent reasons, any one of which would be sufficient.

### 1. The inference has no scientific basis

Inferring criminal intent, honesty, or disposition from facial appearance is
physiognomy. It has been tested and it does not work. Studies claiming to
classify "criminality" from face photographs have been repeatedly shown to be
learning artefacts of how the two photo sets were produced — lighting, camera,
collar and tie, the difference between an ID photo and a mugshot — rather than
anything about the people in them. There is no measurement here to make more
accurate; there is no signal.

The weaker claim — that facial *expression* reveals emotional state — is also
much shakier than the interface of a demo like this suggests. The largest
systematic review of the evidence (Barrett et al., *Psychological Science in the
Public Interest*, 2019) concluded that people's facial movements vary
substantially in how they express emotion across situations and cultures, and
that emotional state cannot be reliably inferred from facial configuration alone.
A "happy" reading from this model means the corners of a mouth are raised. That
is all it means.

And the intermediate claim — that intent can be read from behaviour in crowd
footage — is the premise that behaviour-detection systems have consistently
failed to deliver on. The clearest case is the UK's £2.7m Project Champion and,
more instructively, the US TSA's SPOT programme: a 2013 Government
Accountability Office review found no valid evidence that behavioural indicators
identify people who pose a threat, after roughly a billion dollars of spending.

### 2. The base rate makes it useless even if it worked

Suppose a camera sees 50,000 people a day and 5 of them are committing the
offence you care about. Suppose you have a detector far better than anything that
exists: 99% sensitivity and 99% specificity.

- True positives: ~5
- False positives: 1% of 49,995 ≈ **500**

You have produced 500 accusations against innocent people per camera per day to
find 5 real events — and that is the optimistic case with a detector that does
not exist. Push specificity to 99.9% and you still generate 50 false accusations
a day. Rare events plus imperfect classifiers plus large populations is a
structural problem, not a tuning problem. It does not go away with a better model.

Now consider who absorbs those 500 stops, and note that the errors are not
randomly distributed.

### 3. It is unlawful in a large part of the world

This is not a grey area in most jurisdictions with a modern data protection
regime. Illustrative, not exhaustive, and not legal advice:

- **EU AI Act** (prohibitions applicable from 2 February 2025) bans, among
  others: predictive policing that assesses the risk of a person committing a
  criminal offence based solely on profiling or personality traits; untargeted
  scraping of facial images to build recognition databases; biometric
  categorisation to infer sensitive attributes; and — with narrow, judicially
  authorised law-enforcement exceptions — real-time remote biometric
  identification in publicly accessible spaces. Emotion inference is prohibited
  outright in workplaces and education, and is high-risk elsewhere.
- **GDPR**: biometric data processed to uniquely identify a person is special
  category data under Article 9 and needs a specific condition, not just consent
  theatre. Public-space deployment triggers a mandatory Data Protection Impact
  Assessment (Article 35). There is no way to obtain valid consent from everyone
  walking past a traffic camera.
- **US state law**: Illinois BIPA requires written consent before collecting a
  face template and gives individuals a private right of action with statutory
  damages — it has produced nine-figure settlements. Texas CUBI and Washington's
  biometric statute are similar in substance.

A public URL advertising criminal detection is itself the evidence in any
enforcement action against it.

### What the errors actually look like

The age model's published error for this class of architecture is roughly ±4–8
years, and it is worst on exactly the faces this use case would turn on:
children, older adults, and darker skin tones. The landmark NIST FRVT
demographic-effects study (NISTIR 8280, 2019) found false-positive rates in
one-to-one matching varying by factors of 10 to 100 across demographic groups,
with the highest rates for West and East African and East Asian faces, and
elevated error for children and the elderly.

So the concrete failure mode of a "detect child trafficking" system is: a parent
or grandparent is stopped in front of their own child because a model put the
child at 15 instead of 9 and the adult's face scored poorly against a watchlist.
The system's errors land hardest on the people it claims to protect.

### How this is actually detected

Trafficking is identified through tip lines and hotlines, trained frontline staff
at transport hubs, NGO and social-services outreach, and financial-pattern
analysis by banks and financial intelligence units — with human case work at the
centre and a named person accountable for each decision. Pickpocketing is
addressed through staffing, layout, lighting, and prompt reporting. Neither is a
face-analytics problem, and treating it as one diverts money and attention from
what does work.

## If public-safety analytics is the real goal

There is a lawful, evidence-based version. It differs in kind, not degree.

**Do not process faces at all.** Detect people as anonymous shapes. The useful
signals are about *scenes*, not individuals:

- crowd density and flow rate against a safety threshold,
- counter-flow in a one-way area, or a sudden dispersal,
- an object left stationary in a zone for N minutes,
- a person on the ground (fall detection),
- a vehicle in a pedestrian area, or a stopped vehicle in a live lane,
- queue length at a junction.

Each of these is a measurable physical fact with a defensible error rate. None
of them require knowing who anyone is, and none of them assert intent.

**Design constraints that make it defensible:**

| Constraint | Why |
|---|---|
| Edge processing; frames discarded immediately, only counts and events retained | Minimises the data that can leak or be repurposed |
| No identity, no demographics, no intent labels | Keeps it out of the prohibited and high-risk categories |
| Every alert is an attention cue to a trained human, never an automated decision | Preserves accountability and satisfies GDPR Art. 22 |
| Every alert logged with its outcome, reviewed regularly | Lets you measure the false-positive rate instead of guessing |
| Published accuracy, broken down by subgroup | Makes disparate error rates visible rather than latent |
| DPIA, lawful basis, signage, retention limits, access control, audit, appeal route | The legal baseline for public-space deployment |
| Deployed only by an entity with the legal authority to do so | A private site cannot lawfully do this |

That last row matters most. Public-space surveillance is not something a web app
can opt into. It requires a public body with a mandate, a legal basis, and a
process for people to challenge what it does to them.

## Using this demo responsibly

It is fine for what it is: showing people how on-device computer vision works,
what these models see, and how confidently they are wrong. If you extend it,
keep the boundary where it is:

- Do not add identity matching, watchlists, or cross-session linkage.
- Do not present expression scores as emotional or mental states.
- Do not attach any score named "risk", "suspicion", "threat", or "deception" —
  naming a number that way makes a claim the model cannot support.
- Do not deploy it against people who have not chosen to stand in front of it.

## References

- Barrett, Adolphs, Marsella, Martinez & Pollak (2019). "Emotional Expressions
  Reconsidered." *Psychological Science in the Public Interest*, 20(1).
- Grother, Ngan & Hanaoka (2019). *Face Recognition Vendor Test Part 3:
  Demographic Effects.* NISTIR 8280, NIST.
- US Government Accountability Office (2013). *Aviation Security: TSA Should
  Limit Future Funding for Behavior Detection Activities.* GAO-14-159.
- Regulation (EU) 2024/1689 (Artificial Intelligence Act), Article 5.
- Regulation (EU) 2016/679 (GDPR), Articles 9, 22 and 35.
- Illinois Biometric Information Privacy Act, 740 ILCS 14.
