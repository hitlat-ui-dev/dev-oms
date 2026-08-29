"use client";
import { FiLogOut, FiCheckSquare, FiPlus, FiSquare, FiAlertTriangle, FiX } from "react-icons/fi";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import UrgentTaskManagerPanel from "@/components/UrgentTaskManagerPanel";

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ username: string, role: string } | null>(null);
  const [hasNotification, setHasNotification] = useState(false);
  const [showTodoDropdown, setShowTodoDropdown] = useState(false);
  const [todoTasks, setTodoTasks] = useState<any[]>([]);
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const [users, setUsers] = useState<any[]>([]);

  // Autocomplete states
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<any[]>([]);

  const [showUrgentTaskModal, setShowUrgentTaskModal] = useState(false);

  useEffect(() => {
    // 1. Next.js Guard: Ensure window is available
    if (typeof window === "undefined") return;

    const session = localStorage.getItem("oms_user");
    if (!session) {
      router.push("/login");
      return;
    }

    try {
      setUser(JSON.parse(session));
    } catch (e) {
      // Handles rare cases of corrupted local storage on mobile
      router.push("/login");
      return;
    }

    let logoutTimer: NodeJS.Timeout;

    const resetTimer = () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      
      // 120 Minutes
      logoutTimer = setTimeout(() => {
        handleLogout();
        alert("Session expired due to inactivity.");
      }, 2 * 60 * 60 * 1000);
    };

    // 2. Optimized Mobile Events
    const activityEvents = ['touchstart', 'mousedown', 'click', 'keydown', 'scroll'];
    
    // 3. Add 'passive: true' for better mobile scrolling performance
    activityEvents.forEach(event => {
      window.addEventListener(event, resetTimer, { passive: true });
    });

    resetTimer();

    return () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      activityEvents.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (pathname === "/dashboard/todo-chat") {
      setHasNotification(false);
      localStorage.setItem("workspace_last_viewed", String(Date.now()));
      return;
    }

    const checkUpdates = async () => {
      try {
        const lastViewedStr = localStorage.getItem("workspace_last_viewed");
        const lastViewed = lastViewedStr ? Number(lastViewedStr) : 0;

        const todoRes = await fetch("/api/todo?status=Pending&t=" + Date.now());
        if (todoRes.ok) {
          const tasks = await todoRes.json();
          setTodoTasks(tasks);
          if (tasks.length > 0 && pathname !== "/dashboard/todo-chat") {
            const latestTask = tasks[0];
            const taskTime = new Date(latestTask.createdAt).getTime();
            if (taskTime > lastViewed && latestTask.createdBy !== user?.username) {
              setHasNotification(true);
            }
          }
        }
      } catch (err) {
        console.error("Notification check error", err);
      }
    };

    // Once per page visit is enough for the Workspace badge - no recurring
    // background poll (that used to also cover Chat/DMs, both removed).
    checkUpdates();
  }, [pathname, user?.username]);

  const fetchTodoTasks = async () => {
    try {
      const res = await fetch("/api/todo?status=Pending&t=" + Date.now());
      if (res.ok) {
        const data = await res.json();
        setTodoTasks(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (showTodoDropdown) {
      fetchTodoTasks();
    }
  }, [showTodoDropdown]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch("/api/users");
        if (res.ok) {
          const data = await res.json();
          setUsers(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchUsers();
  }, []);

  const handleToggleTask = async (taskId: string, currentStatus: string) => {
    const newStatus = currentStatus === "Pending" ? "Completed" : "Pending";
    setTodoTasks(prev => prev.map(t => t._id === taskId ? { ...t, status: newStatus } : t));

    try {
      await fetch(`/api/todo/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      localStorage.setItem("workspace_last_viewed", String(Date.now()));
    } catch (e) {
      console.error(e);
      fetchTodoTasks();
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoTitle.trim() || isSubmittingTask) return;

    setIsSubmittingTask(true);
    let titleVal = newTodoTitle.trim();
    let assignedToVal = "";
    
    // Parse @name syntax (e.g. @vinit or @vinit buy products)
    const match = titleVal.match(/@(\w+)/);
    if (match) {
      const parsedUser = match[1];
      const foundUser = users.find(u => u.username.toLowerCase() === parsedUser.toLowerCase());
      if (foundUser) {
        assignedToVal = foundUser.username;
        titleVal = titleVal.replace(/@\w+/, "").trim();
      }
    }

    setNewTodoTitle("");

    try {
      const res = await fetch("/api/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleVal,
          description: "",
          assignedTo: assignedToVal,
          dueDate: "",
          reminder: "",
          createdBy: user?.username || "Admin"
        })
      });

      if (res.ok) {
        const result = await res.json();
        setTodoTasks(prev => [result.task, ...prev]);
        localStorage.setItem("workspace_last_viewed", String(Date.now()));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmittingTask(false);
    }
  };

  const handleTaskInputChange = (val: string) => {
    setNewTodoTitle(val);
    
    const atIndex = val.lastIndexOf("@");
    if (atIndex !== -1 && (atIndex === 0 || val[atIndex - 1] === " ")) {
      const searchStr = val.slice(atIndex + 1).toLowerCase();
      const filtered = users.filter(u => 
        u.username.toLowerCase().includes(searchStr) && 
        u.username.toLowerCase() !== user?.username.toLowerCase()
      );
      setFilteredSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleSelectSuggestion = (suggestedUser: string) => {
    const atIndex = newTodoTitle.lastIndexOf("@");
    if (atIndex !== -1) {
      const newVal = newTodoTitle.slice(0, atIndex) + `@${suggestedUser} `;
      setNewTodoTitle(newVal);
    }
    setShowSuggestions(false);
  };

  const handleLogout = () => {
    localStorage.removeItem("oms_user");
    setUser(null);
    router.push("/login");
  };

  if (!user) return null;

  const usernameLower = user.username?.trim().toLowerCase();
  const isOwner = ["chintan", "hitesh"].includes(usernameLower) || (user as any)?.permissions?.boss === true;

  return (
    <>
    <header className="sticky top-0 z-50 flex items-center justify-between gap-2 px-3 md:px-10 py-2 bg-[#0f172a] text-white shadow-lg">
      {/* Clickable Logo - Goes to Dashboard */}
      <Link href="/dashboard" className="flex items-center gap-2 sm:gap-2.5 cursor-pointer group shrink-0 min-w-0">
        <img
          src="/logo-icon.png"
          alt="Dev Enterprise"
          className="h-7 sm:h-8 md:h-9 w-auto object-contain group-hover:opacity-90 transition-opacity shrink-0"
        />
        <span className="flex items-baseline min-w-0">
          <span className="text-lg sm:text-2xl md:text-3xl font-black tracking-tighter text-white group-hover:text-blue-400 transition-colors">Dev</span>
          <span className="text-xs sm:text-sm md:text-base font-bold tracking-tight text-blue-400 ml-1 uppercase">OMS</span>
        </span>
      </Link>

      <div className="flex items-center gap-1.5 sm:gap-4 md:gap-8 shrink-0">

        {/* Workspace Dropdown Popover */}
        <div className="relative">
          <button 
            type="button"
            onClick={() => setShowTodoDropdown(prev => !prev)}
            className="relative text-[10px] md:text-xs font-black uppercase tracking-wider bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 border border-blue-500/35 px-2 sm:px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none"
            title="Workspace To-Do List"
          >
            <FiCheckSquare size={13} /> <span className="hidden sm:inline">Workspace</span>
            {hasNotification && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
            )}
          </button>

          {showTodoDropdown && (
            <>
              {/* Invisible Clickable Backdrop to close dropdown */}
              <div 
                className="fixed inset-0 z-40 bg-transparent"
                onClick={() => setShowTodoDropdown(false)}
              />
              
              {/* Dropdown Card - same viewport-safe positioning as the Chat card above */}
              <div className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-14 sm:top-auto mt-0 sm:mt-2.5 w-auto sm:w-80 md:w-96 max-w-full bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 z-50 text-left animate-in fade-in slide-in-from-top-2 duration-150 flex flex-col">
                <div className="flex justify-between items-center pb-2.5 mb-3 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiCheckSquare className="text-blue-600" size={14} /> Team Tasks
                    {todoTasks.filter(t => t.status === "Pending").length > 0 && (
                      <span className="bg-orange-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                        {todoTasks.filter(t => t.status === "Pending").length}
                      </span>
                    )}
                  </h3>
                  <Link
                    href="/dashboard/todo-chat"
                    onClick={() => setShowTodoDropdown(false)}
                    className="text-[10px] font-black uppercase text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    Open Workspace →
                  </Link>
                </div>

                {/* Tasks List */}
                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                  {todoTasks.filter(t => t.status === "Pending").length === 0 ? (
                    <div className="text-center py-6 text-emerald-600 uppercase tracking-widest text-[10px] font-black">
                      ✓ No pending tasks!
                    </div>
                  ) : (
                    todoTasks.filter(t => t.status === "Pending").map(task => (
                      <button
                        key={task._id}
                        type="button"
                        onClick={() => handleToggleTask(task._id, task.status)}
                        className="w-full flex items-start gap-2.5 p-2.5 bg-slate-50 hover:bg-blue-50 border border-slate-100 hover:border-blue-200 rounded-xl transition-all text-left cursor-pointer group"
                      >
                        <span className="mt-0.5 text-slate-300 group-hover:text-blue-500 transition-colors flex-shrink-0">
                          <FiSquare size={15} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="text-slate-800 font-bold block leading-snug break-words text-xs">{task.title}</span>
                          {task.description && (
                            <span className="text-[10px] text-slate-500 mt-0.5 truncate block leading-relaxed">{task.description}</span>
                          )}
                          <span className="flex flex-wrap items-center gap-2 mt-1">
                            {task.assignedTo && (
                              <span className="text-[8px] font-black uppercase text-orange-700 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded capitalize">
                                {task.assignedTo}
                              </span>
                            )}
                            <span className="text-[8px] text-slate-400 font-bold">By {task.createdBy}</span>
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>

                {/* Inline Add Task Form */}
                <form onSubmit={handleAddTask} className="relative mt-3.5 pt-3 border-t border-slate-100 flex items-center gap-2">
                  {showSuggestions && (
                    <div className="absolute bottom-full left-0 mb-1 w-full bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] p-1 max-h-32 overflow-y-auto">
                      {filteredSuggestions.map(u => (
                        <button
                          key={u._id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectSuggestion(u.username)}
                          className="w-full text-left px-2.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg text-[11px] font-bold text-slate-700 transition-colors cursor-pointer capitalize"
                        >
                          {u.username}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    placeholder="Add task... Use @name to assign"
                    value={newTodoTitle}
                    onChange={(e) => handleTaskInputChange(e.target.value)}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-bold"
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 p-2 rounded-xl text-white transition-all shadow-md shadow-blue-600/20 flex-shrink-0 cursor-pointer disabled:opacity-40"
                    title="Quick Add Task"
                    disabled={!newTodoTitle.trim() || isSubmittingTask}
                  >
                    <FiPlus size={14} />
                  </button>
                </form>
              </div>
            </>
          )}
        </div>

        {/* Urgent Tasks - owner-only, opens the create-form + live list as a
            popup so it's reachable from every page without leaving whatever
            you're currently working on. */}
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowUrgentTaskModal(true)}
            className="relative text-[10px] md:text-xs font-black uppercase tracking-wider bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/35 px-2 sm:px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none"
            title="Urgent Tasks"
          >
            <FiAlertTriangle size={13} /> <span className="hidden sm:inline">Urgent Tasks</span>
          </button>
        )}

        <div className="text-right border-r border-slate-700 pr-2 sm:pr-4 md:pr-8 max-w-16 sm:max-w-none">
          <h2 className="text-xs sm:text-sm md:text-lg font-bold leading-none capitalize truncate">{user.username}</h2>
        </div>

        <button
          onClick={handleLogout}
          className="p-1.5 sm:p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-all rounded-full cursor-pointer flex items-center justify-center shrink-0"
          title="Logout"
        >
          <FiLogOut size={18} className="sm:hidden" />
          <FiLogOut size={20} className="hidden sm:block" />
        </button>
      </div>
    </header>

    {showUrgentTaskModal && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-[#f3f6f9] border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
          <div className="p-5 border-b border-slate-200 bg-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-[#dc2626] text-white p-2.5 rounded-xl">
                <FiAlertTriangle size={18} />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-[#0a2540]">Urgent Tasks</h3>
                <p className="text-[9px] text-[#ff9933] font-black uppercase tracking-widest">Assign & Track</p>
              </div>
            </div>
            <button
              onClick={() => setShowUrgentTaskModal(false)}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <FiX size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <UrgentTaskManagerPanel />
          </div>
        </div>
      </div>
    )}
    </>
  );
}