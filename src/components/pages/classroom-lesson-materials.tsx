import type { LessonStudentContent } from "@/lib/classroom-lessons/domain";
import type { Locale } from "@/i18n/copy";

export function LessonMaterials({
  content,
  locale,
}: {
  content: LessonStudentContent;
  locale: Locale;
}) {
  const zh = locale === "zh-CN";
  return (
    <article className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--foreground)] sm:p-7">
      <h2 className="text-2xl font-semibold">{content.title}</h2>
      {content.objectives.length > 0 ? (
        <section>
          <h3 className="font-semibold">
            {zh ? "学习目标" : "Learning objectives"}
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-7">
            {content.objectives.map((objective, index) => (
              <li key={index}>{objective}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="whitespace-pre-wrap break-words text-base leading-8">
        {content.body}
      </div>
      {content.mediaSlides?.map((slide) => (
        <section
          key={slide.id}
          className="space-y-3 border-t border-[var(--border)] pt-5"
        >
          <h3 className="text-lg font-semibold">{slide.title}</h3>
          {slide.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated, size-limited inline lesson media; never a public asset URL.
            <img
              src={`data:${slide.image.mime};base64,${slide.image.base64}`}
              alt={slide.title}
              className="max-h-[70vh] max-w-full rounded-xl object-contain"
            />
          ) : null}
          {slide.audio ? (
            <audio
              controls
              preload="none"
              aria-label={slide.title}
              src={`data:${slide.audio.mime};base64,${slide.audio.base64}`}
              className="w-full"
            />
          ) : null}
          <p className="whitespace-pre-wrap break-words leading-7">
            {slide.notes}
          </p>
        </section>
      ))}
      {content.questions.length > 0 ? (
        <section className="border-t border-[var(--border)] pt-4">
          <h3 className="font-semibold">
            {zh ? "思考问题" : "Discussion questions"}
          </h3>
          <ol className="mt-3 list-decimal space-y-3 pl-5">
            {content.questions.map((question) => (
              <li key={question.id} className="whitespace-pre-wrap">
                {question.prompt}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}
