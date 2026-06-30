# UAIS Learning Design

Status date: 2026-06-19
Owner roles: S10 maintains the document structure and coordination contract. S16 owns pedagogy, learning-science rationale, and evaluation-quality review.

## Purpose

`LEARNING_DESIGN.md` is the learning-design contract for UAIS. It explains what the teaching website is trying to help learners do, how course knowledge is structured, how practice and feedback should work, how evaluation evidence should be interpreted, and where human teaching judgment must remain in control.

UAIS is not only a course-card website. It is a MAIC-informed university teaching pattern with four connected learning surfaces:

- Course plaza: students choose from two example courses, `大学研究方法` and `数学教学法`.
- Learner playback: students study PPT/narration/subtitles with AI guidance, concept pins, checkpoints, and notes.
- Human-AI chatroom: groups discuss tasks and mention specialized AI agents for research, methods, mathematics, and writing support.
- Teacher workspace: teachers manage courses, content, agents, students, learning records, dashboards, quizzes, grading, and exports.

This document should be updated before major changes to course data, learning workflows, assessment dashboards, agent behavior, or teacher-facing evaluation features.

## Learning Goals

UAIS supports university learners who need to turn course content into observable academic and teaching practice. Across both current courses, learners should be able to:

1. Explain core concepts in language that can be used in class discussion, group work, or a course artifact.
2. Connect concepts to authentic tasks, such as building a research evidence chain or designing a mathematics question sequence.
3. Produce visible evidence of learning: notes, coding sheets, task drafts, discussion records, revised artifacts, micro-teaching plans, or reflection summaries.
4. Collaborate with peers by asking questions, challenging evidence, and integrating feedback from human and AI participants.
5. Use AI agents responsibly as learning supports, not as hidden authors, graders, or replacements for teacher judgment.
6. Reflect on progress using checkpoints, teacher feedback, group records, and assessment rubrics.

The default success criterion is not "the learner clicked through the unit." A unit is successful when the learner can use the target idea in a task and leave evidence that a teacher can inspect.

## Knowledge Structure

UAIS organizes knowledge as practice-oriented progressions rather than isolated topics. Each course should define:

- Concept spine: the ideas students must understand.
- Practice spine: the actions students must learn to perform.
- Evidence spine: the artifacts and records that show progress.
- Feedback spine: where teacher, peer, and AI feedback enter the loop.

### Course: 大学研究方法

| Layer | Knowledge Focus | Practice Focus | Evidence Students Should Produce |
| --- | --- | --- | --- |
| Orientation | Research questions and evidence awareness | Narrow a broad interest into an investigable question | A draft research question with observable evidence notes |
| Literature and Concepts | Literature reading, concepts, and frameworks | Extract constructs and relationships from sources | A short concept map or annotated reading note |
| Variables and Evidence | Variable relationships and classroom evidence | Translate a question into observable dimensions | A variable-evidence table |
| Coding and Data | Coding sheets, interview notes, classroom clips, assignment evidence | Build a shared evidence protocol | A group coding sheet and example coded item |
| Research Design | Sampling, data collection, ethics, validity | Justify a small study design | A research design draft |
| Analysis and Writing | Evidence quality, interpretation, academic claims | Turn data patterns into warranted claims | A revised report section with feedback history |

### Course: 数学教学法

| Layer | Knowledge Focus | Practice Focus | Evidence Students Should Produce |
| --- | --- | --- | --- |
| Orientation | Mathematical concept expression | Explain a concept for classroom use | A short teacher explanation and student-facing example |
| Examples and Question Chains | Worked examples, questioning sequence, cognitive demand | Turn an example into observe-explain-transfer questions | A question-chain script |
| Misconceptions | Student errors, misconceptions, and diagnostic prompts | Anticipate where understanding may break | A misconception map with teacher responses |
| Representations | Symbolic, visual, verbal, and contextual representations | Compare representations and solution paths | A representation comparison note |
| Classroom Interaction | Teacher follow-up, peer explanation, micro-discussion | Facilitate concept-focused discourse | A micro-teaching plan or rehearsal record |
| Reflection and Revision | Evidence from teaching practice | Revise teaching moves from feedback | A revised task with reflection on evidence used |

These progressions are design baselines. The current source data only exposes selected units and mocked records; future course-data expansion should preserve this structure unless S16 approves a revised learning model.

## Practice Logic

Each UAIS unit should follow a repeatable learning loop:

1. Orient: show the unit goal, target concepts, and why the task matters.
2. Learn: present teacher explanation through PPT, narration, subtitles, and examples.
3. Check: ask a short checkpoint that reveals whether the learner can use the concept.
4. Practice: assign a task that produces an artifact, not only a right/wrong answer.
5. Discuss: move ambiguity, peer critique, and agent questions into the chatroom.
6. Revise: require learners to improve the artifact after feedback.
7. Reflect: record what changed, what evidence supported the change, and what remains unclear.

Exercise difficulty should move from recognition to production:

| Level | Exercise Type | Example in Research Methods | Example in Mathematics Pedagogy |
| --- | --- | --- | --- |
| 1 | Recall and noticing | Identify the research question in a case | Identify the target concept in an example |
| 2 | Concept use | Match variables to evidence sources | Label question-chain levels |
| 3 | Diagnostic judgment | Judge whether a data source supports a claim | Diagnose a student misconception |
| 4 | Design task | Draft a research design section | Write a classroom question sequence |
| 5 | Revision task | Improve a report after peer/AI/teacher feedback | Revise a micro-teaching plan after critique |

No unit should rely only on passive video/PPT consumption. Playback is the entry point; practice, discussion, revision, and evidence are the learning design.

## Feedback Mechanism

UAIS feedback should be layered so learners receive fast guidance while teachers retain authority over instructional decisions.

| Feedback Source | Primary Role | Should Provide | Should Not Provide |
| --- | --- | --- | --- |
| Teacher | Instructional authority and final interpretation | Learning goals, rubrics, priority feedback, grades, sensitive decisions | Secret provider configuration or automated-only grading |
| Peers | Collaborative sense-making | Alternative explanations, evidence challenges, rehearsal feedback | Final correctness authority without teacher review |
| AI guide | Slide-level and task-level scaffolding | Hints, task decomposition, concept reminders, next-step prompts | Hidden completion of assignments or final grades |
| Specialist AI agents | Domain-specific support | Research-variable advice, method critique, math-solution comparison, writing structure | Unsupported factual claims, private data decisions, teacher replacement |
| Learning dashboard | Pattern visibility | Participation, progress, pending tasks, checkpoint trends | Moral judgment, high-stakes classification, unexplained scoring |

Feedback timing should follow the learning loop:

- During playback: short hints, subtitles, concept pins, and "ask this slide" prompts.
- During practice: checkpoint feedback and task-specific hints.
- During chat: agent responses that cite the learner's current task context.
- During revision: teacher or rubric-based comments that ask for evidence of change.
- After unit completion: summary feedback that names strengths, gaps, and next actions.

## Evaluation Approach

UAIS evaluation should combine formative, process, and summative evidence. It must not reduce learning to page visits or AI chat volume.

### Student Model

The student model describes what the learner is expected to develop:

- Conceptual understanding: can explain target concepts accurately.
- Practice capability: can perform the target academic or teaching move.
- Evidence judgment: can connect claims to observable evidence.
- Collaboration quality: can contribute, question, and revise in group work.
- Responsible AI use: can disclose, critique, and improve AI-supported work.

### Evidence Model

The evidence model defines what records can support claims about learning:

- PPT playback checkpoints and concept-pin activity.
- Notes, drafts, coding sheets, question-chain scripts, and micro-teaching plans.
- Human-AI chatroom messages, mentions, revisions, and exported collaboration records.
- Teacher comments, rubric ratings, and grade records.
- Dashboard summaries of participation, progress, task completion, and quiz performance.

Evidence must be interpreted with context. A learner who asks many AI questions may be engaged, confused, delegating too much, or doing careful revision. The record becomes useful when paired with artifact quality, teacher feedback, and revision history.

### Task Model

Every assessed task should specify:

- Target concept and target practice.
- Required artifact.
- Allowed AI support.
- Required human feedback or peer interaction.
- Rubric dimensions.
- Revision expectation.
- Evidence sources to preserve.

### Evaluation Types

| Type | Purpose | UAIS Evidence | Human Review Requirement |
| --- | --- | --- | --- |
| Formative checkpoint | Help learners adjust during a unit | Short answers, slide questions, concept pins, AI hints | Teacher samples trends and reviews flagged misconceptions |
| Practice artifact | Judge whether learners can use the concept | Research design draft, coding sheet, question chain, micro-teaching plan | Teacher or TA reviews with rubric |
| Collaboration record | Understand group participation and reasoning | Chatroom threads, agent mentions, peer critique, export record | Teacher reviews for quality, equity, and academic integrity |
| Summative performance | Make course-level judgment | Revised artifact, presentation, quiz, written reflection, grade record | Teacher owns final score and feedback |
| Course-improvement analytics | Improve instruction | Aggregated progress, error patterns, task bottlenecks | Teacher interprets before changing instruction |

## Pedagogical Basis

S16 should maintain this section as the evidence-grounded learning-design rationale. The current baseline is:

1. Thick authenticity: UAIS tasks should align personal meaning, real-world use, disciplinary ways of thinking, and authentic assessment. This supports the product choice to make students produce research artifacts, classroom question chains, and collaboration records rather than only watch content. Evidence anchor: Shaffer and Resnick, `Thick authenticity: New media and authentic learning` (1999, local id J004, Grade A).
2. Professional-practice modeling: Learning activities should model valued academic and teaching practices. Research Methods asks students to reason like novice researchers; Mathematics Pedagogy asks them to reason like novice teachers designing classroom interaction. Evidence anchors: Shaffer, `Epistemic Games` (2005, J012, Grade A) and Shaffer, `Epistemic Network Analysis: A prototype for 21st-century assessment of learning` (2009, J017, Grade A).
3. Action plus reflection: Practice tasks should pair doing with reflection. A chat export, revised artifact, or feedback history is valuable because it shows not only what students produced but how their reasoning changed.
4. Evidence-centered assessment: UAIS should align the student model, evidence model, and task model before adding dashboards or automated scores. Evidence anchor: Shaffer, `Epistemic Network Analysis: A prototype for 21st-century assessment of learning` (2009, J017, Grade A).
5. Communities of practice: The human-AI chatroom should support participation in a learning community, where students, teachers, peers, and tools share responsibility for visible reasoning. Evidence anchor: Shaffer, `Pedagogical praxis: Using technology to build professional communities of practice` (2004, J010, Grade A).
6. Teacher professional judgment: Technology can expand what teachers can coordinate and inspect, but it should not remove responsibility for goals, standards, care, or evaluation. Evidence anchor: Shaffer, Nash, and Ruis, `Technology and the new professionalization of teaching` (2015, J018, Grade A).

These anchors are local corpus evidence, not an exhaustive literature review. If UAIS later publishes a research paper or public evaluation report, S16 should expand this section into APA 7 references and add broader learning-science sources.

## Human-AI Collaboration Boundary

UAIS treats AI as a scaffolded participant in learning, not as the owner of pedagogy, assessment, or student identity.

### AI May Do

- Explain a slide or concept in simpler language.
- Suggest next steps for a task.
- Compare methods, solution paths, or draft structures.
- Ask clarifying questions that help students specify evidence.
- Help generate study notes, task checklists, or revision prompts.
- Surface patterns for teacher review.

### AI Must Not Do

- Assign final grades or make high-stakes progression decisions.
- Replace teacher feedback on summative artifacts.
- Present unsupported claims as course truth.
- Hide its contribution to student work.
- Use private or proprietary course materials without approved rights.
- Read, expose, or depend on real credentials in client surfaces, logs, docs, or exports.
- Infer sensitive student traits from chat or analytics without explicit approved policy.

### Human Responsibilities

- Teachers define learning goals, task design, rubrics, final feedback, and grades.
- Students remain responsible for understanding, authorship, revision, and disclosure of AI assistance.
- Peers provide critique and alternative reasoning but do not replace teacher review.
- Product sessions must preserve privacy, consent, and source boundaries when adding AI, voice, PPT, export, or analytics features.

## Course Authoring Checklist

Every new or revised UAIS unit should answer these questions before it is added to source data or UI:

- What is the learning goal?
- What knowledge point or practice does it develop?
- What will students do, not only watch?
- What artifact or observable record will show progress?
- What feedback will the learner receive during the unit?
- Which AI agents are allowed to help, and how?
- Where does human teacher judgment enter?
- What rubric or evaluation evidence will be used?
- What data should be exportable for review?
- What privacy, consent, or academic-integrity constraints apply?

## Coordination Notes

- S10 may update document structure, cross-session coordination language, and project-management notes.
- S16 should review any new pedagogical theory, evaluation framework, research claim, or learning-design rationale.
- S08 should coordinate changes that turn this document into typed data structures in `src/data/uais.ts`.
- S09 should coordinate bilingual copy and accessible wording in UI surfaces.
- S11 should coordinate regression or acceptance tests that enforce learning-design invariants.
- S04 and S24 should coordinate chatroom export/share and artifact-export evidence quality.
- S12, S19, and S22 should coordinate backend, environment, and release implications before live AI, analytics, or export services are connected.
