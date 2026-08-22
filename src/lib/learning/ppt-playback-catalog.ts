import type { Locale } from "@/i18n/copy";
import { readPublishedPlaybackFiles } from "@/lib/learning/published-playback-store";

type PublishedLearningUnit = {
  lessonKey: string;
  position: number;
  title: {
    "zh-CN": string;
    "en-US": string;
  };
};

type PublishedPptPlayback = {
  courseId: string;
  courseTitle: string;
  sourceDeckTitle: string;
  teacherName: string;
  voiceLabel: string;
  audioManifestId: string;
  pptAssetId: string;
  learningUnit?: PublishedLearningUnit;
  slides: Array<{
    slideId: string;
    slideTitle: string;
    narrationText: string;
    audioId: string;
    durationSeconds: number;
  }>;
  localized?: Partial<Record<Locale, PublishedPptPlaybackLocaleCopy>>;
};

const KANG_XIA_MANIFEST_ID =
  "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1";
const KANG_XIA_AUDIO_ID_PREFIX = "tts_natural-number-ordinal-theory-ppt1";
const KANG_XIA_SLIDE_DURATIONS_SECONDS = [
  15.52,
  14.56,
  14,
  14,
  15.36,
  15.2,
  15.04,
  12.32,
  14.56,
  15.28,
  17.76,
  14.4,
  15.04,
  14.4,
  15.68,
  15.52,
  14.24,
  16.64,
  15.68,
];

type PublishedPptPlaybackLocaleCopy = {
  courseTitle: string;
  sourceDeckTitle: string;
  teacherName: string;
  voiceLabel: string;
  slides: Array<{
    slideId: string;
    slideTitle: string;
    narrationText: string;
  }>;
};

const publishedPlaybacks: PublishedPptPlayback[] = [
  {
    courseId: "elementary-math-research",
    courseTitle: "初等数学研究",
    sourceDeckTitle: "初等数学研究+PPT1+自然数的序数理论.pptx",
    teacherName: "康霞博士",
    voiceLabel: "康霞博士克隆声音",
    audioManifestId: KANG_XIA_MANIFEST_ID,
    pptAssetId: "natural-number-ordinal-theory-ppt1",
    slides: withKangXiaAudioMetadata([
      {
        slideId: "slide-01",
        slideTitle: "自然数的序数理论",
        narrationText:
          "同学们好，今天我们进入初等数学研究的一个基础主题：自然数的序数理论。我们会从自然数到底是什么开始，逐步看到它如何支撑后面的数学结构。",
      },
      {
        slideId: "slide-02",
        slideTitle: "学习线索",
        narrationText:
          "这节课有三个核心线索：是什么、为什么学、以及如何教。请大家带着重点、难点和容易忽略的盲点来听，而不是只记住几个结论。",
      },
      {
        slideId: "slide-03",
        slideTitle: "自然数的意义",
        narrationText:
          "本讲先讨论自然数的意义。我们要追问，自然数不仅是计数工具，它还可以表达顺序、结构和推理规则，这是序数理论的入口。",
      },
      {
        slideId: "slide-04",
        slideTitle: "自然数的本质",
        narrationText:
          "第一个问题是自然数的本质。第二个问题是我们熟悉的 1 加 1 等于 2。看似简单的等式，背后其实需要清楚说明什么是 1、什么是 2、什么是加法。",
      },
      {
        slideId: "slide-05",
        slideTitle: "数字的数量与顺序",
        narrationText:
          "第三个问题是数字 5 和数字 2 的含义是否一样。它们都是数字，但在数量、顺序和结构位置上并不相同。理解差异，才能理解自然数系统。",
      },
      {
        slideId: "slide-06",
        slideTitle: "为什么建立序数理论",
        narrationText:
          "为什么要建立自然数的序数理论？因为现代数学需要从实数、有理数、整数一路追问到自然数的基础。自然数理论就是许多数学大厦的地基。",
      },
      {
        slideId: "slide-07",
        slideTitle: "五条公理",
        narrationText:
          "接下来我们看如何建立自然数序数理论。这里会出现五条公理，它们不是孤立规定，而是在回答自然数从哪里开始、怎样延续、怎样区分的问题。",
      },
      {
        slideId: "slide-08",
        slideTitle: "自然数的起点",
        narrationText:
          "第一条公理告诉我们，1 是自然数。这一步看似朴素，却给自然数系统确定了起点。没有起点，后续的顺序和生成都无从谈起。",
      },
      {
        slideId: "slide-09",
        slideTitle: "后继规则",
        narrationText:
          "有了起点之后，我们还要说明每个自然数怎样产生下一个自然数。序数理论关注的不是简单罗列，而是用规则保证自然数可以不断向后延伸。",
      },
      {
        slideId: "slide-10",
        slideTitle: "避免混淆",
        narrationText:
          "同时，我们还需要避免混淆。不同自然数要能被区分，同一个生成过程不能产生矛盾。公理体系的作用，就是让这些直觉变成严格规则。",
      },
      {
        slideId: "slide-11",
        slideTitle: "严谨框架",
        narrationText:
          "把这些公理合在一起，我们得到一个关于自然数的严谨框架。它帮助我们说明自然数如何开始、如何后继、如何排除重复，以及如何支持归纳推理。",
      },
      {
        slideId: "slide-12",
        slideTitle: "现实应用",
        narrationText:
          "自然数序数理论不仅是抽象基础，也有广泛应用。数学基础是现代科技发展的底层逻辑，许多算法、编码和安全系统都离不开自然数结构。",
      },
      {
        slideId: "slide-13",
        slideTitle: "加法定义",
        narrationText:
          "第六个问题是如何严谨定义加法。加法不是只靠经验理解，而可以通过归纳定义来刻画。这样我们才能说明加法的本质和它为什么可靠。",
      },
      {
        slideId: "slide-14",
        slideTitle: "把熟悉变成可证明",
        narrationText:
          "回到前面的问题，自然数的本质和 1 加 1 等于 2，都可以在更严格的理论框架中得到解释。学习基础理论，就是把熟悉变成可证明。",
      },
      {
        slideId: "slide-15",
        slideTitle: "教学情境",
        narrationText:
          "现在把视角转向教学情境。手机支付和网银转账为什么能安全传输？这个问题可以引出自然数、编码和数学结构的现实意义，也适合翻转课堂。",
      },
      {
        slideId: "slide-16",
        slideTitle: "问题链转化",
        narrationText:
          "教学转化的关键，是把抽象理论变成学生能理解的问题链。我们可以从自然数的意义讲起，再过渡到序数理论、加法定义和真实应用。",
      },
      {
        slideId: "slide-17",
        slideTitle: "理论入口",
        narrationText:
          "这一页把问题情境、自然数意义、前沿应用和小结放在一起。请大家注意，好的数学教学不是删去理论，而是为理论找到合适的进入方式。",
      },
      {
        slideId: "slide-18",
        slideTitle: "本讲小结",
        narrationText:
          "本讲小结包括自然数的本质、1 加 1 等于 2、自然数的双重意义，以及皮亚诺算术等内容。请大家把这些内容看成一个相互支撑的结构。",
      },
      {
        slideId: "slide-19",
        slideTitle: "作业布置",
        narrationText:
          "最后是作业布置。请完成一次师范训练，录制约十分钟微视频，面向小学生讲授自然数内容。重点不是背诵概念，而是把概念讲清楚、讲准确。",
      },
    ]),
    localized: {
      "en-US": {
        courseTitle: "Elementary Mathematics Research",
        sourceDeckTitle:
          "Elementary Mathematics Research PPT 1 Ordinal Theory of Natural Numbers.pptx",
        teacherName: "Dr. Kang Xia",
        voiceLabel: "Dr. Kang Xia cloned voice",
        slides: [
          {
            slideId: "slide-01",
            slideTitle: "Ordinal theory of natural numbers",
            narrationText:
              "Hello everyone. Today we begin a foundational topic in elementary mathematics research: the ordinal theory of natural numbers. We will start with what natural numbers are and then see how they support later mathematical structures.",
          },
          {
            slideId: "slide-02",
            slideTitle: "Learning path",
            narrationText:
              "This lesson has three core threads: what it is, why we study it, and how to teach it. Listen for the key points, difficulties, and easily missed blind spots, rather than only memorizing conclusions.",
          },
          {
            slideId: "slide-03",
            slideTitle: "Meaning of natural numbers",
            narrationText:
              "We first discuss the meaning of natural numbers. Natural numbers are not only counting tools; they can also express order, structure, and rules of reasoning. This is the entry point to ordinal theory.",
          },
          {
            slideId: "slide-04",
            slideTitle: "Nature of natural numbers",
            narrationText:
              "The first question is the nature of natural numbers. The second is the familiar statement that one plus one equals two. Behind this simple equation, we still need to explain what one, two, and addition mean.",
          },
          {
            slideId: "slide-05",
            slideTitle: "Quantity and order",
            narrationText:
              "The third question asks whether the numbers five and two have the same meaning. They are both numbers, but they differ in quantity, order, and structural position. Understanding that difference helps us understand the natural-number system.",
          },
          {
            slideId: "slide-06",
            slideTitle: "Why build ordinal theory",
            narrationText:
              "Why do we build an ordinal theory of natural numbers? Modern mathematics traces foundations from real numbers, rational numbers, and integers back to natural numbers. Natural-number theory is the foundation under many mathematical structures.",
          },
          {
            slideId: "slide-07",
            slideTitle: "Five axioms",
            narrationText:
              "Next we examine how to build ordinal theory for natural numbers. Five axioms appear here. They are not isolated rules; they answer where natural numbers begin, how they continue, and how they remain distinct.",
          },
          {
            slideId: "slide-08",
            slideTitle: "Starting point",
            narrationText:
              "The first axiom tells us that one is a natural number. This step looks simple, but it fixes the starting point of the natural-number system. Without a starting point, later order and generation have no basis.",
          },
          {
            slideId: "slide-09",
            slideTitle: "Successor rule",
            narrationText:
              "After the starting point, we must explain how each natural number generates the next one. Ordinal theory is not just a list; it uses rules to ensure that natural numbers can extend step by step.",
          },
          {
            slideId: "slide-10",
            slideTitle: "Avoiding confusion",
            narrationText:
              "We also need to avoid confusion. Different natural numbers must be distinguishable, and the same generation process cannot create contradictions. The axiomatic system turns these intuitions into strict rules.",
          },
          {
            slideId: "slide-11",
            slideTitle: "Rigorous framework",
            narrationText:
              "Putting these axioms together gives us a rigorous framework for natural numbers. It explains how natural numbers begin, how successors work, how repetition is excluded, and how induction is supported.",
          },
          {
            slideId: "slide-12",
            slideTitle: "Real-world applications",
            narrationText:
              "Ordinal theory of natural numbers is not only an abstract foundation; it also has broad applications. Mathematical foundations are part of the logic beneath modern technology, and many algorithms, coding systems, and security systems depend on natural-number structures.",
          },
          {
            slideId: "slide-13",
            slideTitle: "Defining addition",
            narrationText:
              "The sixth question is how to define addition rigorously. Addition is not understood only through experience; it can be characterized through recursive definition. This helps us explain the nature of addition and why it is reliable.",
          },
          {
            slideId: "slide-14",
            slideTitle: "Making the familiar provable",
            narrationText:
              "Returning to the earlier questions, both the nature of natural numbers and one plus one equals two can be explained within a stricter theoretical framework. Studying foundations means making the familiar provable.",
          },
          {
            slideId: "slide-15",
            slideTitle: "Teaching context",
            narrationText:
              "Now we shift to teaching context. Why can mobile payments and online bank transfers transmit information securely? This question can introduce natural numbers, coding, and the real meaning of mathematical structure, and it also fits a flipped classroom.",
          },
          {
            slideId: "slide-16",
            slideTitle: "Question-chain transformation",
            narrationText:
              "The key to teaching transformation is turning abstract theory into a sequence of questions that students can understand. We can begin with the meaning of natural numbers and then move toward ordinal theory, the definition of addition, and real applications.",
          },
          {
            slideId: "slide-17",
            slideTitle: "Entry point into theory",
            narrationText:
              "This slide brings together the problem context, the meaning of natural numbers, frontier applications, and a summary. Please note that good mathematics teaching does not remove theory; it finds an appropriate entry point into theory.",
          },
          {
            slideId: "slide-18",
            slideTitle: "Lesson summary",
            narrationText:
              "The lesson summary includes the nature of natural numbers, one plus one equals two, the dual meaning of natural numbers, and Peano arithmetic. Treat these ideas as a mutually supporting structure.",
          },
          {
            slideId: "slide-19",
            slideTitle: "Assignment",
            narrationText:
              "Finally, here is the assignment. Complete a teacher-training task by recording a roughly ten-minute micro-video for primary students about natural numbers. The focus is not reciting concepts, but explaining them clearly and accurately.",
          },
        ],
      },
    },
  },
];

// Every lookup goes through here.
//
// File-published decks come FIRST and the compiled-in demo deck last, so a JSON
// file can override the demo course by re-using its courseId - which is how a
// real September deck replaces the placeholder without a code change. Deduped
// by courseId so the override is total rather than ambiguous.
//
// Synchronous by design: see published-playback-store.ts for why the whole
// chain from `authorizeLearningPptPlaybackAccess` down must stay sync.
function readAllPublishedPlaybacks(): PublishedPptPlayback[] {
  const merged = [...readPublishedPlaybackFiles(), ...publishedPlaybacks];
  const byCourseId = new Map<string, PublishedPptPlayback>();
  for (const playback of merged) {
    if (!byCourseId.has(playback.courseId)) {
      byCourseId.set(playback.courseId, playback);
    }
  }
  return [...byCourseId.values()];
}

export function findPublishedPlaybackByCourseId(courseId: string) {
  const safeCourseId = requireSafeId(courseId, "course id");
  return readAllPublishedPlaybacks().find((playback) => playback.courseId === safeCourseId);
}

export function assertPublishedLearningPptPlaybackAudio(input: {
  manifestId: string;
  audioId: string;
}) {
  const manifestId = requireSafeId(input.manifestId, "manifest id");
  const audioId = requireSafeId(input.audioId, "audio id");
  const published = readAllPublishedPlaybacks().find(
    (playback) => playback.audioManifestId === manifestId,
  );
  if (!published) {
    throw new Error("PPT playback audio is not published for learning.");
  }
  const slideNumber = Number(audioId.match(/slide-(\d+)$/)?.[1]);
  const expectedSlide = Number.isFinite(slideNumber)
    ? published.slides[slideNumber - 1]
    : undefined;
  if (!expectedSlide || !audioId.endsWith(expectedSlide.slideId)) {
    throw new Error("PPT playback audio is not part of the published learning manifest.");
  }
}

export function findPublishedLearningPptPlaybackAudio(input: {
  manifestId: string;
  audioId: string;
}) {
  assertPublishedLearningPptPlaybackAudio(input);
  const manifestId = requireSafeId(input.manifestId, "manifest id");
  const audioId = requireSafeId(input.audioId, "audio id");
  const published = readAllPublishedPlaybacks().find(
    (playback) => playback.audioManifestId === manifestId,
  );
  if (!published) {
    throw new Error("PPT playback audio is not published for learning.");
  }
  return {
    courseId: published.courseId,
    manifestId,
    audioId,
    filename: `${audioId}.wav`,
    publicPath: `/learning/ppt-playback/audio/${manifestId}/${audioId}.wav`,
  };
}

function requireSafeId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function withKangXiaAudioMetadata(
  slides: Array<Pick<PublishedPptPlayback["slides"][number], "slideId" | "slideTitle" | "narrationText">>,
) {
  return slides.map((slide, index) => {
    const durationSeconds = KANG_XIA_SLIDE_DURATIONS_SECONDS[index];
    if (durationSeconds === undefined) {
      throw new Error("Missing published Kang Xia slide audio duration.");
    }
    return {
      ...slide,
      audioId: `${KANG_XIA_AUDIO_ID_PREFIX}_${slide.slideId}`,
      durationSeconds,
    };
  });
}

export type { PublishedLearningUnit, PublishedPptPlayback };
