"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { Brain } from "@phosphor-icons/react/dist/ssr/Brain";
import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { Eye } from "@phosphor-icons/react/dist/ssr/Eye";
import { EyeSlash } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { GraduationCap } from "@phosphor-icons/react/dist/ssr/GraduationCap";
import { Laptop } from "@phosphor-icons/react/dist/ssr/Laptop";
import { LockKey } from "@phosphor-icons/react/dist/ssr/LockKey";
import { MagicWand } from "@phosphor-icons/react/dist/ssr/MagicWand";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { Student } from "@phosphor-icons/react/dist/ssr/Student";
import { UserCircle } from "@phosphor-icons/react/dist/ssr/UserCircle";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { copy } from "@/i18n/copy";
import {
  resolveLocalizedFailure,
  type FailureReasonResponseBody,
  type LocalizedFailure,
} from "@/i18n/failure-reason-copy";
import {
  getUaisHomeHrefForRole,
  isUaisRouteAllowedForRole,
} from "@/lib/auth/uais-app-session";

const loginCopy = {
  "zh-CN": {
    language: "中文",
    brandName: "优爱思",
    brandSubline: "大学人工智能系统",
    welcome: "欢迎来到优爱思：多智能体赋能的个性化学习和教学智能平台",
    accountLogin: "账号密码登录",
    // 「账号」而不是「账号或邮箱」会让这一整批用邮箱注册的学生以为自己没有账号。
    // 服务端把提交的标识符规范化后同时比对账号和已登记邮箱，文案照实说明。
    accountLabel: "账号或邮箱",
    accountPlaceholder: "教师账号、学生账号或注册邮箱",
    passwordLabel: "密码",
    passwordPlaceholder: "请输入密码",
    submit: "立即登录",
    showPassword: "显示密码",
    hidePassword: "隐藏密码",
    // 这里从未真正收集过同意：页面上没有勾选框，按钮也不检查任何状态。
    // 改成登录即视为同意的隐含式表述，与实际发生的事情一致。
    consent: "登录即表示同意",
    consentSeparator: "与",
    // 链接文字沿用 /terms 与 /privacy 两页自己的标题，不另起名字，
    // 否则学生点开「服务条款」看到的却是标题为「用户协议」的页面。
    terms: "《用户协议》",
    privacy: "《隐私政策》",
    emptyError: "请输入账号和密码。",
    invalidError: "账号或密码不匹配，请使用已授权的 UAIS 账号登录。",
    serverError: "登录服务暂时不可用，请稍后再试。",
    learnerHeadline: "学生全自主学习",
    learnerAccent: "个性化学习",
    learnerChipOne: "多智能体即时回应",
    learnerChipTwo: "学习节奏自动跟进",
    learnerChipThree: "每个疑问都有高质量回答",
    learnerCardFooter: "智能课程与学情线索，助力每一位学生成长",
    teacherHeadline: "教师全智能辅助",
    teacherAccent: "个性化教学",
    teacherChipOne: "高度自定义教学界面",
    teacherChipTwo: "智能助教即时反馈",
    teacherChipThree: "教学管理更轻盈",
    teacherCardFooter: "个性化教学、智能辅助，让教学更高效",
  },
  "en-US": {
    language: "EN",
    brandName: "UAIS",
    brandSubline: "University AI System",
    welcome:
      "Welcome to UAIS: an intelligent platform where multi-agent AI powers personalized learning and teaching.",
    accountLogin: "Account Login",
    accountLabel: "Account or email",
    accountPlaceholder: "Teacher account, student account, or registered email",
    passwordLabel: "Password",
    passwordPlaceholder: "Enter password",
    submit: "Log In",
    showPassword: "Show password",
    hidePassword: "Hide password",
    consent: "By signing in you agree to the",
    consentSeparator: "and",
    terms: "Terms of Use",
    privacy: "Privacy Policy",
    emptyError: "Enter an account and password.",
    invalidError: "The account or password does not match an authorized UAIS account.",
    serverError: "The login service is temporarily unavailable. Please try again.",
    learnerHeadline: "Self-paced student learning",
    learnerAccent: "Personalized learning",
    learnerChipOne: "Multi-agent AI responds in context",
    learnerChipTwo: "Learning pace stays visible",
    learnerChipThree: "Every question gets a high-quality answer",
    learnerCardFooter: "AI courses and learning signals support every student's growth.",
    teacherHeadline: "Intelligent teacher support",
    teacherAccent: "Personalized teaching",
    teacherChipOne: "Highly customizable teaching interface",
    teacherChipTwo: "Instant AI teaching-assistant feedback",
    teacherChipThree: "Teaching work stays lighter",
    teacherCardFooter: "Personalized teaching and AI support make teaching more efficient.",
  },
} as const;

type LoginFailure = LocalizedFailure & {
  // Rendered only for failures the reader cannot fix by editing this form.
  supportChannel?: boolean;
};

type LoginDeckCard = {
  id: "learner" | "teacher";
  title: string;
  accent: string;
  chips: [string, string, string];
  footer: string;
  assetSrc: string;
  assetAlt: string;
};

export function LoginPage() {
  const router = useRouter();
  const { locale, toggleLocale } = useAppPreferences();
  const t = loginCopy[locale];
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // The failure carries its own optional raw detail, so an unmapped server string
  // can be shown collapsed instead of being pasted into the student's sentence.
  // `supportChannel` marks the failures the reader cannot resolve alone: an empty
  // field is not one of them, and pointing that student at their teacher would be
  // noise dressed up as help.
  const [failure, setFailure] = useState<LoginFailure>();
  const [submitting, setSubmitting] = useState(false);
  const authCopy = copy[locale].auth;

  const cards: LoginDeckCard[] = [
    {
      id: "learner",
      title: t.learnerHeadline,
      accent: t.learnerAccent,
      chips: [t.learnerChipOne, t.learnerChipTwo, t.learnerChipThree],
      footer: t.learnerCardFooter,
      assetSrc: "/login/uais-student-card-illustration.png",
      assetAlt:
        locale === "zh-CN"
          ? "两位不戴眼镜的学生使用平板电脑和笔记本电脑自主学习"
          : "Two students without glasses learning with a tablet and laptop",
    },
    {
      id: "teacher",
      title: t.teacherHeadline,
      accent: t.teacherAccent,
      chips: [t.teacherChipOne, t.teacherChipTwo, t.teacherChipThree],
      footer: t.teacherCardFooter,
      assetSrc: "/login/uais-teacher-card-illustration.png",
      assetAlt:
        locale === "zh-CN"
          ? "戴眼镜的女教师手持平板和指示笔准备智能课程"
          : "A female teacher wearing glasses holds a tablet and pointer for an AI course",
    },
  ];

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFailure(undefined);

      if (!account.trim() || !password) {
        setFailure({ message: t.emptyError });
        return;
      }

      setSubmitting(true);
      try {
        const from = new URLSearchParams(window.location.search).get("from");
        const response = await fetch("/api/auth/app-session", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            account,
            password,
            from,
          }),
        });
        const result = (await response.json().catch(() => null)) as
          | (FailureReasonResponseBody & {
              redirectTarget?: string;
              appSession?: {
                actor?: {
                  role?: "teacher" | "student";
                };
              };
            })
          | null;

        if (!response.ok) {
          // The 401 keeps its own sentence because the route deliberately gives
          // every credential failure the same body; the rest resolve through the
          // shared reason-code map, and only a code the map has never seen falls
          // back to the generic sentence with the server's own string collapsed
          // underneath it.
          setFailure(
            response.status === 401
              ? { message: t.invalidError, supportChannel: true }
              : {
                  ...resolveLocalizedFailure({
                    body: result,
                    locale,
                    fallbackMessage: t.serverError,
                  }),
                  supportChannel: true,
                },
          );
          return;
        }

        const role = result?.appSession?.actor?.role;
        const fallback = role ? getUaisHomeHrefForRole(role) : "/courses";
        const target =
          result?.redirectTarget &&
          isSafeLocalRedirectTarget(result.redirectTarget) &&
          (!role || isUaisRouteAllowedForRole(result.redirectTarget, role))
            ? result.redirectTarget
            : fallback;
        router.replace(target);
      } catch {
        setFailure({ message: t.serverError, supportChannel: true });
      } finally {
        setSubmitting(false);
      }
    },
    [account, locale, password, router, t.emptyError, t.invalidError, t.serverError],
  );

  return (
    <div className="min-h-[100dvh] overflow-hidden bg-[#fbfdff] text-[#151a32] dark:bg-[#0b1220] dark:text-[#eef6ff]">
      <div className="mx-auto grid min-h-[100dvh] w-full max-w-[1760px] grid-cols-1 lg:grid-cols-[1.18fr_0.82fr]">
        <section className="relative hidden min-h-[100dvh] items-center px-10 py-10 lg:flex">
          <div className="absolute left-10 top-8 flex items-center gap-3 xl:left-16">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-[#1f6feb] text-white shadow-[0_14px_34px_rgba(31,111,235,0.24)]">
              <Sparkle size={23} weight="duotone" />
            </span>
            <span>
              <span className="block text-lg font-semibold tracking-tight">{t.brandName}</span>
              <span className="block text-xs font-medium text-[#647089] dark:text-[#b8c7dc]">
                {t.brandSubline}
              </span>
            </span>
          </div>

          <div className="relative mx-auto w-full max-w-[930px]">
            <LoginDesignDeck cards={cards} />
          </div>
        </section>

        <main className="relative flex min-h-[100dvh] items-center px-5 py-8 sm:px-8 lg:px-10 xl:px-16">
          <button
            type="button"
            onClick={toggleLocale}
            className="absolute right-5 top-5 inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold text-[#202640] outline-none transition hover:bg-[#eef4ff] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1f6feb] dark:text-[#eef6ff] dark:hover:bg-[#17243a] sm:right-8 sm:top-8"
            aria-label={locale === "zh-CN" ? "切换到英文" : "Switch to Chinese"}
          >
            {t.language}
            <CaretDown size={14} weight="bold" />
          </button>

          <div className="mx-auto w-full max-w-[560px] pt-16 lg:pt-0">
            <div className="mb-10 flex items-center gap-3 lg:hidden">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-[#1f6feb] text-white shadow-[0_14px_34px_rgba(31,111,235,0.24)]">
                <Sparkle size={23} weight="duotone" />
              </span>
              <span>
                <span className="block text-lg font-semibold tracking-tight">{t.brandName}</span>
                <span className="block text-xs font-medium text-[#647089] dark:text-[#b8c7dc]">
                  {t.brandSubline}
                </span>
              </span>
            </div>

            <LoginMobileDesignCarousel cards={cards} />

            <h1 className="text-4xl font-black leading-[1.16] tracking-normal text-[#171b35] dark:text-[#f5f8ff] sm:text-5xl">
              {t.welcome}
            </h1>

            <div className="mt-9 inline-flex border-b border-[#1f6feb] pb-2 text-base font-bold text-[#1f6feb]">
              {t.accountLogin}
            </div>

            <form onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate>
              <label className="block space-y-2" htmlFor="uais-login-account">
                <span className="text-sm font-semibold text-[#2a314a] dark:text-[#dce8fb]">
                  {t.accountLabel}
                </span>
                <span className="relative block">
                  <UserCircle
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#7d8aa3]"
                    size={21}
                    weight="duotone"
                  />
                  <input
                    id="uais-login-account"
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    className="h-14 w-full rounded-lg border border-[#c8d9f5] bg-white pl-12 pr-4 text-base font-medium text-[#18213a] outline-none transition placeholder:text-[#8794aa] focus:border-[#1f6feb] focus:ring-4 focus:ring-[#1f6feb]/15 dark:border-[#31507a] dark:bg-[#111c2e] dark:text-[#eef6ff] dark:placeholder:text-[#8ea2bd]"
                    autoComplete="username"
                    // A student typing an address on a phone should get the
                    // email keyboard and no autocapitalisation - the identifier
                    // is compared lower-cased, and a capitalised first letter is
                    // the most likely way a correct address fails to match.
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={t.accountPlaceholder}
                  />
                </span>
              </label>

              <label className="block space-y-2" htmlFor="uais-login-password">
                <span className="text-sm font-semibold text-[#2a314a] dark:text-[#dce8fb]">
                  {t.passwordLabel}
                </span>
                <span className="relative block">
                  <LockKey
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#7d8aa3]"
                    size={21}
                    weight="regular"
                    data-uais-login-password-icon="lock-key"
                  />
                  <input
                    id="uais-login-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-14 w-full rounded-lg border border-[#c8d9f5] bg-white pl-12 pr-12 text-base font-medium text-[#18213a] outline-none transition placeholder:text-[#8794aa] focus:border-[#1f6feb] focus:ring-4 focus:ring-[#1f6feb]/15 dark:border-[#31507a] dark:bg-[#111c2e] dark:text-[#eef6ff] dark:placeholder:text-[#8ea2bd]"
                    autoComplete="current-password"
                    placeholder={t.passwordPlaceholder}
                    type={showPassword ? "text" : "password"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-3 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-[#6a7892] outline-none transition hover:bg-[#eef4ff] hover:text-[#1f6feb] focus-visible:ring-2 focus-visible:ring-[#1f6feb] dark:hover:bg-[#1b2c49]"
                    // Was Chinese-only, so an English-locale screen reader
                    // announced the one control on this form whose purpose is
                    // not visible in a language its user had not chosen.
                    aria-label={showPassword ? t.hidePassword : t.showPassword}
                  >
                    {showPassword ? (
                      <EyeSlash size={20} weight="duotone" />
                    ) : (
                      <Eye size={20} weight="duotone" />
                    )}
                  </button>
                </span>
              </label>

              {failure ? (
                <div
                  role="alert"
                  data-uais-login-failure
                  className="rounded-lg border border-[#f0b7c9] bg-[#fff1f5] px-4 py-3 text-sm font-semibold text-[#a12f56] dark:border-[#89435b] dark:bg-[#321420] dark:text-[#ffb7ca]"
                >
                  <p>{failure.message}</p>
                  {/* A sign-in the student cannot complete now ends by naming
                      someone they can actually ask. The sentence itself lives in
                      copy.ts so the real channel replaces it in one place. */}
                  {failure.supportChannel ? (
                    <p
                      data-uais-support-channel
                      className="mt-1 text-xs font-medium text-[#a12f56]/85 dark:text-[#ffb7ca]/85"
                    >
                      {authCopy.supportChannel}
                    </p>
                  ) : null}
                  {failure.rawDetail ? (
                    <details className="mt-2 text-xs font-medium">
                      <summary className="cursor-pointer text-[#a12f56]/85 dark:text-[#ffb7ca]/85">
                        {authCopy.technicalDetail}
                      </summary>
                      <p
                        data-uais-login-failure-detail
                        className="mt-1 break-words font-normal text-[#a12f56]/85 dark:text-[#ffb7ca]/85"
                      >
                        {failure.rawDetail}
                      </p>
                    </details>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-14 w-full items-center justify-center rounded-xl bg-[#1f6feb] px-6 text-base font-bold text-white shadow-[0_14px_34px_rgba(31,111,235,0.25)] outline-none transition hover:bg-[#1557c0] active:translate-y-px focus-visible:ring-4 focus-visible:ring-[#1f6feb]/25"
              >
                {t.submit}
              </button>

              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#69758d] dark:text-[#aebeda]">
                <CheckCircle size={17} weight="duotone" className="text-[#1f6feb]" />
                <span>{t.consent}</span>
                <a
                  href="/terms"
                  className="font-semibold text-[#1f6feb] underline-offset-4 hover:underline"
                >
                  {t.terms}
                </a>
                <span>{t.consentSeparator}</span>
                <a
                  href="/privacy"
                  className="font-semibold text-[#1f6feb] underline-offset-4 hover:underline"
                >
                  {t.privacy}
                </a>
              </p>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}

function isSafeLocalRedirectTarget(value: string) {
  return value.startsWith("/") && !value.startsWith("//");
}

function LoginMobileDesignCarousel({ cards }: { cards: LoginDeckCard[] }) {
  return (
    <div
      className="-mx-5 mb-8 overflow-x-auto px-5 pb-3 lg:hidden"
      data-uais-login-mobile-carousel
      aria-label="UAIS login illustration cards"
    >
      <div className="flex w-max snap-x gap-4">
        {cards.map((card) => (
          <div
            key={card.id}
            className="w-[376px] shrink-0 snap-center"
            style={{ aspectRatio: "376 / 520" }}
          >
            <LoginDesignCard card={card} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LoginDesignDeck({ cards }: { cards: LoginDeckCard[] }) {
  return (
    <div
      className="relative w-full max-w-[930px]"
      data-uais-login-design-deck
      style={{ aspectRatio: "766 / 520" }}
    >
      <div className="grid h-full grid-cols-2 gap-[14px]">
        {cards.map((card) => (
          <LoginDesignCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

function LoginDesignCard({ card }: { card: LoginDeckCard }) {
  const learner = card.id === "learner";
  const cardKind = learner ? "student" : "teacher";
  const primaryChip = learner ? card.chips[0] : card.chips[2];
  const secondaryChip = learner ? card.chips[2] : card.chips[1];
  const tertiaryChip = learner ? card.chips[1] : card.chips[0];
  const FooterIcon = learner ? Laptop : BookOpen;
  const footerIconKind = learner ? "laptop" : "book";

  return (
    <article
      className="relative flex h-full flex-col overflow-hidden rounded-[14px] border border-[#d8e6fb] bg-gradient-to-b from-white via-[#fbfdff] to-[#f2f7ff] px-[18px] pb-[16px] pt-[18px] shadow-[0_14px_42px_rgba(42,82,148,0.12)] 2xl:px-[20px] 2xl:pb-[18px] 2xl:pt-[20px]"
      data-uais-login-card={cardKind}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(31,111,235,0.08),transparent_42%)]" />
      <div className="relative z-20 text-center">
        <h2
          className="text-[20px] font-black leading-[1.05] text-[#65728c] 2xl:text-[24px]"
          data-uais-login-card-heading
        >
          {card.title}
          <span className="ml-1 text-[#1f6feb]">{card.accent}</span>
        </h2>
      </div>

      <div
        className="relative z-20 mt-6 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3 2xl:mt-7 2xl:gap-4"
        data-uais-login-media-stack
      >
        <div
          className="relative overflow-hidden rounded-[10px] border border-[#dfebfb] bg-[#f7fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]"
          data-uais-login-asset-frame
        >
          <Image
            src={card.assetSrc}
            alt={card.assetAlt}
            fill
            sizes="300px"
            priority
            unoptimized
            className="object-contain object-center"
            data-uais-login-asset
          />
        </div>

        <div
          className="relative z-30 grid grid-cols-1 gap-2 2xl:gap-3"
          data-uais-login-feature-rail
        >
          <FeatureChip
            icon={
              learner ? (
                <GraduationCap size={22} weight="duotone" />
              ) : (
                <UsersThree size={22} weight="duotone" />
              )
            }
          >
            {primaryChip}
          </FeatureChip>
          <FeatureChip
            icon={
              learner ? (
                <Student size={22} weight="duotone" />
              ) : (
                <PaperPlaneTilt size={22} weight="duotone" />
              )
            }
          >
            {secondaryChip}
          </FeatureChip>
          <FeatureChip
            icon={
              learner ? (
                <Brain size={22} weight="duotone" />
              ) : (
                <MagicWand size={22} weight="duotone" />
              )
            }
          >
            {tertiaryChip}
          </FeatureChip>
        </div>
      </div>

      <div
        className="relative z-30 mt-5 flex min-h-[58px] items-center justify-center gap-3 rounded-[8px] border border-[#d6e4fb] bg-[#edf5ff] px-4 py-3 text-center text-[13px] font-bold leading-[1.25] text-[#384967] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] 2xl:mt-6 2xl:min-h-[64px] 2xl:gap-4 2xl:text-[15px]"
        data-uais-login-footer-band
      >
        <FooterIcon
          size={28}
          weight="duotone"
          className="shrink-0 text-[#1f6feb]"
          data-uais-login-footer-icon={footerIconKind}
          aria-hidden="true"
        />
        <span className="min-w-0">{card.footer}</span>
      </div>
    </article>
  );
}

function FeatureChip({
  children,
  icon,
}: {
  children: string;
  icon: ReactNode;
}) {
  return (
    <div
      className="flex min-h-[54px] w-full items-center gap-3 rounded-[8px] border border-[#d9e7fb] bg-white/95 px-4 py-3 text-[13px] font-black leading-[1.18] text-[#26304b] shadow-[0_12px_26px_rgba(42,82,148,0.12)] backdrop-blur 2xl:min-h-[60px] 2xl:text-[15px]"
      data-uais-login-feature-chip
    >
      <span
        className="grid size-7 shrink-0 place-items-center text-[#1f6feb] 2xl:size-8"
        data-uais-login-feature-icon
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 leading-[1.18]" data-uais-login-feature-label>
        {children}
      </span>
    </div>
  );
}
