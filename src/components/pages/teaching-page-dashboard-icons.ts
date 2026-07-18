import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { Books } from "@phosphor-icons/react/dist/ssr/Books";
import { ChartBar } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { Exam } from "@phosphor-icons/react/dist/ssr/Exam";
import { Export as ExportIcon } from "@phosphor-icons/react/dist/ssr/Export";
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { UserGear } from "@phosphor-icons/react/dist/ssr/UserGear";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";

// Teacher-workspace sidebar/operation icon map (Phase 3 decomposition of
// teaching-page.tsx). Shared by the page shell and the extracted workspace panels.
export const dashboardIcons = {
  courses: BookOpen,
  "course-settings": GearSix,
  content: FileText,
  agents: Robot,
  "knowledge-base": Books,
  admins: UserGear,
  students: UsersThree,
  "data-export": ExportIcon,
  dashboard: ChartBar,
  "quiz-board": Exam,
  grading: ClipboardText,
  "invite-code": QrCode,
};
