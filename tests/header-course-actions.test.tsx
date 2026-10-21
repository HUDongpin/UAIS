import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Header } from '@/components/layout/header';
import * as rosterNavigation from '@/lib/teaching/class-roster-navigation';
import { headerActivities, headerCatalog, headerDashboard, headerStudent, headerTeacher } from './helpers/header-course-activity-fixture';
let pathname = '/teaching';
let locale = 'zh-CN';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('next/link', () => ({ default: ({ href, children, prefetch, ...props }: {
        href: string;
        children: ReactNode;
        prefetch?: boolean;
    }) => { void prefetch; return <a href={href} {...props}>{children}</a>; } }));
vi.mock('@/components/providers/app-preferences', () => ({ useAppPreferences: () => ({ locale, theme: 'light', toggleLocale: vi.fn(), toggleTheme: vi.fn() }) }));
beforeEach(() => { pathname = '/teaching'; locale = 'zh-CN'; vi.unstubAllGlobals(); Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function () { this.setAttribute('open', ''); } }); Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); } }); });
it('opens a data-backed calendar, refreshes from the server and returns focus on close', async () => {
    const fetcher = vi.fn(async (path: string) => Response.json(path === '/api/teaching/courses' ? headerCatalog() : headerActivities()));
    vi.stubGlobal('fetch', fetcher);
    render(<Header initialSessionUser={headerTeacher}/>);
    expect(fetcher).not.toHaveBeenCalled();
    const opener = screen.getByRole('button', { name: '日历', exact: true });
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: '课程日历' });
    await within(dialog).findByText('真实任务');
    expect(within(dialog).getByRole('link', { name: '管理课程任务' }).getAttribute('href')).toBe('/teaching/courses/course-a/activities');
    expect(dialog.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-21T08:00:00.000Z');
    fireEvent.click(within(dialog).getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
});
it('opens current approval notifications without claiming unread or delivery', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(headerCatalog())));
    render(<Header initialSessionUser={headerTeacher}/>);
    fireEvent.click(screen.getByRole('button', { name: '通知', exact: true }));
    const dialog = await screen.findByRole('dialog', { name: '通知中心' });
    await within(dialog).findByText('待审批入班申请');
    expect(within(dialog).getByRole('link', { name: '打开班级名册' }).getAttribute('href')).toBe('/teaching#uais-class-roster-class-a');
    expect(dialog.textContent).not.toContain('未读');
});
it('shows retry on failure and never mistakes the failure for an empty calendar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    render(<Header initialSessionUser={headerTeacher}/>);
    fireEvent.click(screen.getByRole('button', { name: '日历', exact: true }));
    const dialog = await screen.findByRole('dialog', { name: '课程日历' });
    await within(dialog).findByRole('alert');
    expect(within(dialog).queryByText('暂无已发布任务的截止时间。')).toBeNull();
    expect(within(dialog).getByRole('button', { name: '重试' })).toBeTruthy();
});
it('discards an open account-scoped read when the session or route changes', async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const view = render(<Header initialSessionUser={headerTeacher}/>);
    fireEvent.click(screen.getByRole('button', { name: '日历', exact: true }));
    await screen.findByRole('dialog');
    view.rerender(<Header />);
    finish(Response.json(headerCatalog()));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: '日历', exact: true })).toBeNull();
});
it('closes on native cancel and discards the dialog when navigation changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(headerCatalog())));
    const view = render(<Header initialSessionUser={headerTeacher}/>);
    const opener = screen.getByRole('button', { name: '通知', exact: true });
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    await screen.findByRole('dialog');
    pathname = '/courses';
    view.rerender(<Header initialSessionUser={headerTeacher}/>);
    expect(screen.queryByRole('dialog')).toBeNull();
});
it('describes student submission-bound deadlines without calling them the latest published version', async () => {
    const dashboard = headerDashboard();
    dashboard.courses[0].units[0].activityId = 'version-one';
    dashboard.courses[0].units[0].submission.state = 'submitted';
    dashboard.courses[0].units[0].feedback.status = 'awaiting-teacher';
    vi.stubGlobal('fetch', vi.fn(async (path: string) => Response.json(path === '/api/teaching/courses' ? headerCatalog('student') : dashboard)));
    render(<Header initialSessionUser={headerStudent}/>);
    fireEvent.click(screen.getByRole('button', { name: '日历', exact: true }));
    const dialog = await screen.findByRole('dialog', { name: '课程日历' });
    await within(dialog).findByText('单元 1');
    expect(within(dialog).getByText('按学习工作区当前关联的任务版本显示截止时间（香港时间）。')).toBeTruthy();
    expect(dialog.textContent).not.toContain('最新已发布版本');
    expect(dialog.querySelector('[data-uais-header-item="deadline:class-a:version-one"] time')?.getAttribute('datetime')).toBe('2026-10-21T08:00:00.000Z');
});
it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('preserves native roster link activation for %j', async (modifiers) => {
    const navigate = vi.spyOn(rosterNavigation, 'openSamePageClassRoster').mockReturnValue(true);
    try {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json(headerCatalog())));
        render(<Header initialSessionUser={headerTeacher}/>);
        const opener = screen.getByRole('button', { name: '通知', exact: true });
        fireEvent.click(opener);
        const dialog = await screen.findByRole('dialog', { name: '通知中心' });
        const link = await within(dialog).findByRole('link', { name: '打开班级名册' });
        expect(fireEvent.click(link, modifiers)).toBe(true);
        expect(navigate).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBe(dialog);
        fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(document.activeElement).toBe(opener);
    }
    finally {
        navigate.mockRestore();
    }
});
it('closes and intercepts an ordinary same-page roster link activation', async () => {
    const navigate = vi.spyOn(rosterNavigation, 'openSamePageClassRoster').mockReturnValue(true);
    try {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json(headerCatalog())));
        render(<Header initialSessionUser={headerTeacher}/>);
        fireEvent.click(screen.getByRole('button', { name: '通知', exact: true }));
        const dialog = await screen.findByRole('dialog', { name: '通知中心' });
        const link = await within(dialog).findByRole('link', { name: '打开班级名册' });
        expect(fireEvent.click(link)).toBe(false);
        expect(navigate).toHaveBeenCalledExactlyOnceWith('/teaching#uais-class-roster-class-a');
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    finally {
        navigate.mockRestore();
    }
});
it("recovers from a failed read and replaces stale items on refresh", async () => {
    let fail = true;
    let empty = false;
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
        if (fail)
            return new Response("{}", { status: 503 });
        const data = path === "/api/teaching/courses" ? headerCatalog() : headerActivities();
        if (empty && "activities" in data)
            data.activities = [];
        return Response.json(data);
    }));
    render(<Header initialSessionUser={headerTeacher}/>);
    fireEvent.click(screen.getByRole("button", { name: "日历", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "课程日历" });
    await within(dialog).findByRole("alert");
    fail = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "重试" }));
    await within(dialog).findByText("真实任务");
    empty = true;
    fireEvent.click(within(dialog).getByRole("button", { name: "刷新" }));
    expect(within(dialog).queryByText("真实任务")).toBeNull();
    await within(dialog).findByText("暂无已发布任务的截止时间。");
});
it.each([401, 403])("offers a real login recovery link for HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
    render(<Header initialSessionUser={headerStudent}/>);
    fireEvent.click(screen.getByRole("button", { name: "通知", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "通知中心" });
    await within(dialog).findByRole("alert");
    expect(within(dialog).getByRole("link", { name: "重新登录" }).getAttribute("href"))
        .toBe("/login?from=%2Fstudent-dashboard");
    expect(within(dialog).queryByText("暂无可显示的班级申请或学习反馈。")).toBeNull();
});
it("renders English feedback with the exact learning activity link", async () => {
    locale = "en-US";
    vi.stubGlobal("fetch", vi.fn(async (path: string) => Response.json(path === "/api/teaching/courses" ? headerCatalog("student") : headerDashboard())));
    render(<Header initialSessionUser={headerStudent}/>);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    const dialog = screen.getByRole("dialog", { name: "Notification center" });
    await within(dialog).findByText("Teacher revision feedback released");
    expect(within(dialog).getByRole("link", { name: "Open learning activity" }).getAttribute("href"))
        .toBe("/learning?courseId=course-a&classId=class-a&lessonKey=lesson-a&activityId=11111111-1111-4111-8111-111111111111");
});
it("aborts the old account read and never shows its response for another account", async () => {
    let finish!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_path: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>((resolve) => { finish = resolve; });
    }));
    const view = render(<Header initialSessionUser={headerTeacher}/>);
    fireEvent.click(screen.getByRole("button", { name: "通知", exact: true }));
    view.rerender(<Header initialSessionUser={{ ...headerTeacher, account: "another-teacher" }}/>);
    expect(signal?.aborted).toBe(true);
    finish(Response.json(headerCatalog()));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Real course")).toBeNull();
});
