import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LegalDocument } from "@/app/legal-document";
import { defaultLocale, supportedLocales, type Locale } from "@/i18n/copy";

const metadataByLocale: Record<Locale, Metadata> = {
  "zh-CN": {
    title: "隐私政策 | 优爱思",
    description: "优爱思隐私政策，说明教学平台如何收集、使用、保存、共享和保护个人信息。",
  },
  "en-US": {
    title: "Privacy Policy | UAIS",
    description:
      "UAIS privacy policy for how the teaching platform collects, uses, stores, shares, and protects personal information.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  return metadataByLocale[getSupportedLocale(cookieStore.get("uais-locale")?.value)];
}

const privacySectionsZh = [
  {
    title: "我们收集的信息",
    paragraphs: [
      "当您使用优爱思时，我们可能根据您的角色和使用场景收集账号信息、课程身份、班级或小组关系、登录状态、设备与浏览器信息、课程访问记录、学习进度、课堂互动、人工智能对话、教师管理操作、导出请求、错误日志和安全审计记录。",
      "教师或课程管理员可能在课程设置中提供课程名称、教学计划、课件、练习、评价规则、学生名单、分组信息和课堂活动说明。学生可能提交提问、讨论内容、作业片段、学习反馈、播放记录和与人工智能互动的上下文。",
      "我们不主动要求您提交与教学无关的敏感信息。请避免在平台中输入身份证件号码、银行账户、健康诊断、家庭住址、个人密钥、平台密码、未授权第三方资料或其他不必要的敏感内容。",
    ],
  },
  {
    title: "来源与收集方式",
    paragraphs: [
      "信息可能由您主动输入、教师或学校授权导入、系统在您使用服务时自动生成，或由经过授权的第三方服务在完成认证、人工智能处理、存储、音频生成、导出或安全检测时返回。",
      "我们会通过浏览器会话标识、本地会话、服务器日志、课程状态记录和接口调用记录维持登录、保护受限页面、记住界面偏好、排查错误并防止滥用。您可以通过浏览器设置管理部分会话标识，但禁用必要会话标识可能导致无法登录或无法访问课程。",
    ],
  },
  {
    title: "我们如何使用信息",
    paragraphs: [
      "我们使用信息来创建和维护账号会话、展示课程内容、记录学习进度、支持教师管理、提供人工智能辅助回答、生成课堂反馈、完成导出、处理技术支持请求、保障系统安全和改进服务体验。",
      "在教学场景中，教师和管理员可能查看学生的课程参与、学习进度、互动记录、作业线索和人工智能对话摘要，以便提供反馈、调整教学活动、识别需要帮助的学生并维护课堂秩序。",
      "我们也可能使用去标识化、汇总或统计信息来分析功能质量、系统稳定性、教学活动趋势和产品可用性。此类分析会尽量减少对具体个人的识别。",
    ],
  },
  {
    title: "人工智能服务与第三方处理",
    paragraphs: [
      "为提供人工智能问答、课程摘要、教师辅助、语音或课件导出等能力，优爱思可能将必要的提示词、课程上下文、用户问题、文件片段或任务参数发送给经授权的人工智能模型、存储、转码、部署和监控服务提供方。",
      "我们会努力遵循最小必要原则，仅发送完成请求所需的信息，并通过配置、访问控制、日志约束和供应商评估降低风险。不同提供方的数据处理位置、保留期限和安全措施可能不同；正式接入前应由平台或机构管理员确认适用的服务条款和数据处理安排。",
      "请不要在人工智能对话中提交不必要的敏感个人信息、未授权学生数据、考试保密材料、第三方商业秘密或真实凭证。人工智能输出可能会基于输入上下文生成回应，教师和学生均应在使用前进行人工判断。",
    ],
  },
  {
    title: "信息共享与披露",
    paragraphs: [
      "我们不会出售您的个人信息。我们可能在以下必要范围内共享信息：向课程教师、助教或学校管理员展示课程管理所需信息；向基础设施、人工智能、存储、分析、安全或客服服务商提供完成服务所需信息；根据法律、监管、司法程序或保护用户、学校、平台安全的合理需要披露信息。",
      "当课程负责人要求导出学习记录、课堂讨论、课件材料或人工智能反馈时，导出文件可能包含个人信息。导出发起者应确认其拥有相应权限，并负责在下载、分享、归档和删除过程中采取适当保护措施。",
    ],
  },
  {
    title: "数据保存与删除",
    paragraphs: [
      "我们会在实现课程服务、教学管理、安全审计、合规留存和争议处理所需期间保存信息。保存期限可能根据课程周期、学校政策、合同、法律要求、备份策略和安全事件处理需要而不同。",
      "课程结束、账号停用或授权关系终止后，部分数据可能被归档、删除、匿名化或继续由学校/课程负责人按其管理规则保存。备份系统中的信息可能需要经过合理周期才会完全清除。",
    ],
  },
  {
    title: "信息安全措施",
    paragraphs: [
      "优爱思会采取合理的技术和管理措施保护信息，包括访问控制、会话校验、受限路由、最小权限、日志审计、错误监控、备份和安全配置检查。对于涉及凭证、接口密钥和部署令牌的材料，平台要求只在授权环境中处理并避免写入公开代码、日志或报告。",
      "尽管我们会持续改进安全措施，但任何互联网服务都无法保证绝对安全。您也应保护好自己的账号、设备和网络环境，避免共享密码，离开公共设备时退出登录，并及时报告异常访问或数据泄露风险。",
    ],
  },
  {
    title: "您的权利与选择",
    paragraphs: [
      "在适用法律和学校管理规则允许范围内，您可以请求访问、更正、补充、删除、导出或限制处理与您相关的个人信息，也可以对某些处理提出异议。学生通常应先联系课程教师或学校指定管理员，教师可联系平台维护人员或机构管理员。",
      "某些信息对于提供课程服务、维护安全和满足教学记录要求是必要的。若您要求删除或限制处理这些信息，可能导致无法继续访问课程、人工智能功能、学习记录或教师管理工具。",
    ],
  },
  {
    title: "学生与未成年人信息",
    paragraphs: [
      "优爱思面向大学教学场景设计，通常由具备相应授权的教师、学生和学校人员使用。如果课程涉及未成年人或特殊保护对象，课程负责人和机构应在使用前确认已取得必要同意、通知和管理安排。",
      "教师和管理员在处理学生信息时，应遵循最小必要、教学目的限定、访问权限控制和保密原则，不应将学生数据用于与课程无关的营销、公开展示、模型训练或其他未经授权的用途。",
    ],
  },
  {
    title: "跨境、第三方链接与外部服务",
    paragraphs: [
      "根据部署区域、云服务、人工智能提供方和课程合作安排，部分数据可能在不同地区的服务器中处理或传输。正式启用涉及跨境处理的能力前，应由机构或平台管理员确认适用法律、合同和数据保护要求。",
      "优爱思页面可能包含外部链接、嵌入媒体、第三方课件、登录服务或下载文件。第三方网站和服务的隐私实践不受本政策完全约束，您在访问或提交信息前应阅读其隐私说明。",
    ],
  },
  {
    title: "政策更新",
    paragraphs: [
      "我们可能根据产品变化、法律要求、学校政策或第三方服务调整更新本隐私政策。更新后的政策会在本页面显示新的生效日期；重大变化会尽合理努力通过页面提示、课程管理渠道或管理员通知说明。",
      "如果您不同意更新后的政策，应停止使用相关服务并联系课程负责人或平台管理员处理后续学习、教学或数据安排。您继续使用优爱思即表示您了解更新后的处理规则。",
    ],
  },
  {
    title: "联系我们",
    paragraphs: [
      "如果您对个人信息处理、学生数据保护、人工智能第三方处理、导出文件安全或权利请求有疑问，请联系课程负责人、学校指定管理员或优爱思项目维护人员。为了保护您和学生的隐私，请不要通过公开渠道发送密码、密钥、完整身份证件号码或其他敏感凭证。",
    ],
  },
] as const;

const privacySectionsEn = [
  {
    title: "Information We Collect",
    paragraphs: [
      "When you use UAIS, we may collect account information, course identity, class or group relationships, login state, device and browser information, course access records, learning progress, classroom interactions, AI conversations, teacher-management actions, export requests, error logs, and security-audit records, depending on your role and use case.",
      "Teachers or course administrators may provide course names, teaching plans, slides, exercises, assessment rules, student rosters, group information, and classroom activity descriptions. Students may submit questions, discussion content, assignment excerpts, learning feedback, playback records, and context used in AI interactions.",
      "We do not ask you to provide sensitive information unrelated to teaching. Please avoid entering identity-document numbers, bank accounts, health diagnoses, home addresses, personal keys, platform passwords, unauthorized third-party information, or other unnecessary sensitive data.",
    ],
  },
  {
    title: "Sources and Collection Methods",
    paragraphs: [
      "Information may be entered by you, imported by teachers or institutions with authorization, generated automatically while you use the service, or returned by authorized third-party services that support authentication, AI processing, storage, audio generation, export, or security checks.",
      "We use browser cookies, local sessions, server logs, course-state records, and API-call records to maintain login, protect restricted pages, remember interface preferences, troubleshoot errors, and prevent abuse. You may manage some cookies through browser settings, but disabling necessary cookies may prevent login or course access.",
    ],
  },
  {
    title: "How We Use Information",
    paragraphs: [
      "We use information to create and maintain account sessions, display course content, record learning progress, support teacher management, provide AI-assisted answers, generate classroom feedback, complete exports, handle technical support requests, maintain security, and improve the service experience.",
      "In teaching scenarios, teachers and administrators may view student participation, progress, interaction records, assignment signals, and AI conversation summaries to provide feedback, adjust teaching activities, identify students who may need support, and maintain classroom order.",
      "We may also use de-identified, aggregated, or statistical information to analyze feature quality, system stability, teaching-activity patterns, and product usability. Such analysis is designed to reduce identification of specific individuals.",
    ],
  },
  {
    title: "AI Services and Third-Party Processing",
    paragraphs: [
      "To provide AI question answering, course summaries, teacher assistance, voice features, and slide or package exports, UAIS may send necessary prompts, course context, user questions, file excerpts, or task parameters to authorized AI model, storage, transcoding, deployment, and monitoring service providers.",
      "We aim to follow data-minimization principles by sending only the information needed to complete the request and reducing risk through configuration, access controls, log constraints, and vendor review. Different providers may have different processing locations, retention periods, and security measures; institutional or platform administrators should confirm applicable terms and data-processing arrangements before formal deployment.",
      "Please do not submit unnecessary sensitive personal information, unauthorized student data, confidential exam materials, third-party trade secrets, or real credentials in AI conversations. AI output may be generated from the input context, so both teachers and students should apply human judgment before using it.",
    ],
  },
  {
    title: "Sharing and Disclosure",
    paragraphs: [
      "We do not sell your personal information. We may share information where necessary to show course-management information to teachers, teaching assistants, or institutional administrators; provide required information to infrastructure, AI, storage, analytics, security, or support vendors; comply with law, regulation, legal process; or protect users, institutions, and platform security.",
      "When course owners request exports of learning records, classroom discussions, slide materials, or AI feedback, export files may contain personal information. The person initiating the export should confirm they have permission and should protect the file during download, sharing, archiving, and deletion.",
    ],
  },
  {
    title: "Retention and Deletion",
    paragraphs: [
      "We retain information for as long as needed to provide course services, support teaching management, conduct security audits, meet compliance requirements, and handle disputes. Retention periods may vary by course cycle, institutional policy, contract, legal requirement, backup strategy, and security-event handling needs.",
      "After a course ends, an account is disabled, or authorization ends, some data may be archived, deleted, anonymized, or retained by the school or course owner under their management rules. Information in backups may take a reasonable period to be fully removed.",
    ],
  },
  {
    title: "Security Measures",
    paragraphs: [
      "UAIS applies reasonable technical and organizational measures to protect information, including access controls, session validation, restricted routes, least privilege, log auditing, error monitoring, backups, and security-configuration checks. Materials involving credentials, API keys, and deployment tokens must be handled only in authorized environments and must not be written into public code, logs, or reports.",
      "No internet service can be absolutely secure even when safeguards are continuously improved. You should also protect your account, device, and network, avoid password sharing, sign out on public devices, and report abnormal access or data-leakage risks promptly.",
    ],
  },
  {
    title: "Your Rights and Choices",
    paragraphs: [
      "Subject to applicable law and institutional management rules, you may request access to, correction of, supplementation of, deletion of, export of, or restriction on processing of personal information related to you. You may also object to certain processing. Students should usually contact the course teacher or designated institutional administrator first; teachers may contact platform maintainers or institutional administrators.",
      "Some information is necessary to provide course services, maintain security, and meet teaching-record requirements. If you request deletion or restriction of necessary information, you may no longer be able to access courses, AI features, learning records, or teacher-management tools.",
    ],
  },
  {
    title: "Student and Minor Information",
    paragraphs: [
      "UAIS is designed for university teaching scenarios and is generally used by authorized teachers, students, and institutional personnel. If a course involves minors or specially protected groups, the course owner and institution should confirm required consent, notices, and management arrangements before use.",
      "Teachers and administrators handling student information should follow data-minimization, teaching-purpose limitation, access-control, and confidentiality principles. Student data should not be used for unrelated marketing, public display, model training, or other unauthorized purposes.",
    ],
  },
  {
    title: "Cross-Border Processing, Links, and External Services",
    paragraphs: [
      "Depending on deployment region, cloud services, AI providers, and course collaboration arrangements, some data may be processed or transferred on servers in different regions. Before enabling capabilities involving cross-border processing, institutions or platform administrators should confirm applicable legal, contractual, and data-protection requirements.",
      "UAIS pages may contain external links, embedded media, third-party courseware, login services, or downloadable files. Third-party websites and services are not fully governed by this Policy, so you should read their privacy notices before visiting them or submitting information.",
    ],
  },
  {
    title: "Policy Updates",
    paragraphs: [
      "We may update this Privacy Policy because of product changes, legal requirements, institutional policies, or third-party service adjustments. The updated page will show a new effective date; material changes will be explained through page notices, course-management channels, or administrator notifications where practical.",
      "If you do not agree with the updated Policy, stop using the relevant services and contact the course owner or platform administrator to handle future learning, teaching, or data arrangements. Continued use of UAIS means you understand the updated processing rules.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      "If you have questions about personal-information processing, student-data protection, AI third-party processing, export-file security, or rights requests, contact your course owner, designated institutional administrator, or UAIS project maintainer. To protect you and students, do not send passwords, keys, full identity-document numbers, or sensitive credentials through public channels.",
    ],
  },
] as const;

export default function PrivacyPage() {
  return (
    <LegalDocument
      updatedAt="2026-06-22"
      content={{
        "zh-CN": {
          title: "隐私政策",
          eyebrow: "优爱思隐私",
          effectiveDateLabel: "生效日期：",
          effectiveDateText: "2026年6月22日",
          backToLogin: "返回登录",
          regionLabel: "隐私政策详细条款",
          intro:
            "本隐私政策说明优爱思在教学、学习、人工智能辅助和教师管理场景中如何收集、使用、保存、共享和保护个人信息。请在使用平台前仔细阅读，并结合您所在课程或机构的具体规则理解。",
          sections: privacySectionsZh,
        },
        "en-US": {
          title: "Privacy Policy",
          eyebrow: "UAIS Privacy",
          effectiveDateLabel: "Effective date:",
          effectiveDateText: "June 22, 2026",
          backToLogin: "Back to login",
          regionLabel: "Privacy Policy details",
          intro:
            "This Privacy Policy explains how UAIS collects, uses, retains, shares, and protects personal information in teaching, learning, AI-assisted, and teacher-management scenarios. Please read it before using the platform and interpret it together with the rules of your course or institution.",
          sections: privacySectionsEn,
        },
      }}
    />
  );
}

function getSupportedLocale(locale: string | undefined): Locale {
  return supportedLocales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}
