export const teachingUnitDraftContent = {
  title: "Correlation and causal claims",
  objectives: ["Distinguish a correlation from a supported causal explanation."],
  activities: [{
    title: "Compare two explanations",
    durationMinutes: 15,
    instructions: "Compare an observational survey with a randomized study. Identify a possible confounder and explain how random assignment changes the interpretation.",
  }],
  lectureScript: "An association describes how two measurements vary together. It does not, by itself, identify why they vary. Suppose students who join a study group earn higher marks. Prior motivation may affect both group membership and performance. A randomized assignment can reduce this selection problem. Ask students which additional evidence would support the claim that the group caused the difference.",
  questions: [{
    prompt: "Why does a positive association between study-group participation and marks not establish that participation caused the improvement?",
    referenceAnswer: "Motivation or prior attainment could influence both participation and marks; association alone does not rule out these confounders.",
  }],
};
