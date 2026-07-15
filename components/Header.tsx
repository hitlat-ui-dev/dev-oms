"use client";
import { FiLogOut, FiSun, FiMoon, FiCheckSquare, FiPlus, FiSquare, FiMessageSquare } from "react-icons/fi";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ username: string, role: string } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [hasNotification, setHasNotification] = useState(false);
  const [showTodoDropdown, setShowTodoDropdown] = useState(false);
  const [todoTasks, setTodoTasks] = useState<any[]>([]);
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const [popoverTab, setPopoverTab] = useState<"tasks" | "chat">("tasks");
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [newChatMessage, setNewChatMessage] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  
  // Autocomplete states
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<any[]>([]);

  // Direct Messaging states
  const [showChatDropdown, setShowChatDropdown] = useState(false);
  const [directMessages, setDirectMessages] = useState<any[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<string>("");
  const [newDmText, setNewDmText] = useState("");
  const [hasDmNotification, setHasDmNotification] = useState(false);

  useEffect(() => {
    // Read theme from cookies on mount
    const match = document.cookie.match(/(^| )oms_theme=([^;]+)/);
    const savedTheme = match ? (match[2] as "dark" | "light") : "dark";
    setTheme(savedTheme);
    if (savedTheme === "light") {
      document.documentElement.classList.add("theme-light");
    } else {
      document.documentElement.classList.remove("theme-light");
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    document.cookie = `oms_theme=${newTheme}; path=/; max-age=31536000`;
    if (newTheme === "light") {
      document.documentElement.classList.add("theme-light");
    } else {
      document.documentElement.classList.remove("theme-light");
    }
  };

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
      
      // 30 Minutes
      logoutTimer = setTimeout(() => {
        handleLogout();
        alert("Session expired due to inactivity.");
      }, 30 * 60 * 1000); 
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
        
        const [chatRes, todoRes, dmRes] = await Promise.all([
          fetch("/api/chat?t=" + Date.now()),
          fetch("/api/todo?t=" + Date.now()),
          user?.username ? fetch(`/api/direct-messages?user=${user.username}&t=${Date.now()}`) : Promise.resolve(null)
        ]);

        if (chatRes.ok) {
          const chats = await chatRes.json();
          setChatMessages(chats);
          if (chats.length > 0 && pathname !== "/dashboard/todo-chat") {
            const latestChat = chats[chats.length - 1];
            const chatTime = new Date(latestChat.createdAt).getTime();
            if (chatTime > lastViewed && latestChat.sender !== user?.username) {
              setHasNotification(true);
            }
          }
        }

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

        if (dmRes && dmRes.ok) {
          const dms = await dmRes.json();
          setDirectMessages(dms);
          const hasUnread = dms.some((dm: any) => 
            dm.recipient.toLowerCase() === user?.username.toLowerCase() && 
            !dm.read && 
            dm.sender.toLowerCase() !== selectedRecipient.toLowerCase()
          );
          setHasDmNotification(hasUnread);
        }
      } catch (err) {
        console.error("Notification check error", err);
      }
    };

    // Run initial check
    checkUpdates();

    const interval = setInterval(checkUpdates, 8000);
    return () => clearInterval(interval);
  }, [pathname, user?.username]);

  const fetchTodoTasks = async () => {
    try {
      const res = await fetch("/api/todo?t=" + Date.now());
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

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatMessage.trim()) return;

    const msgText = newChatMessage;
    setNewChatMessage("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: user?.username || "Admin",
          message: msgText
        })
      });

      if (res.ok) {
        const result = await res.json();
        setChatMessages(prev => [...prev, result.message]);
        localStorage.setItem("workspace_last_viewed", String(Date.now()));
      }
    } catch (e) {
      console.error(e);
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

  const handleSendMessageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDmText.trim() || !selectedRecipient) return;

    const msgText = newDmText.trim();
    setNewDmText("");

    if (selectedRecipient === "all") {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: user?.username || "Admin",
            message: msgText
          })
        });

        if (res.ok) {
          const result = await res.json();
          setChatMessages(prev => [...prev, result.message]);
          localStorage.setItem("workspace_last_viewed", String(Date.now()));
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      try {
        const res = await fetch("/api/direct-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: user?.username || "Admin",
            recipient: selectedRecipient,
            message: msgText
          })
        });

        if (res.ok) {
          const result = await res.json();
          setDirectMessages(prev => [...prev, result.message]);
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleSelectRecipient = async (recipientName: string) => {
    setSelectedRecipient(recipientName);
    
    try {
      await fetch("/api/direct-messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: recipientName,
          recipient: user?.username || ""
        })
      });
      
      setDirectMessages(prev => prev.map(dm => 
        (dm.sender === recipientName && dm.recipient === user?.username) 
          ? { ...dm, read: true } 
          : dm
      ));
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("oms_user");
    setUser(null);
    router.push("/login");
  };

  if (!user) return null;

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-4 md:px-10 py-2 bg-[#0f172a] text-white shadow-lg">
      {/* Clickable Logo - Goes to Dashboard */}
      <Link href="/dashboard" className="flex items-baseline cursor-pointer group">
        <span className="text-2xl md:text-3xl font-black tracking-tighter text-white group-hover:text-blue-400 transition-colors">Dev</span>
        <span className="text-sm md:text-base font-bold tracking-tight text-blue-400 ml-1 uppercase">OMS</span>
      </Link>

      <div className="flex items-center gap-4 md:gap-8">
        
        {/* Chat Dropdown Popover */}
        <div className="relative">
          <button 
            type="button"
            onClick={() => {
              setShowChatDropdown(prev => !prev);
              setShowTodoDropdown(false);
              if (!selectedRecipient) {
                setSelectedRecipient("all");
              }
            }}
            className="relative text-[10px] md:text-xs font-black uppercase tracking-wider bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 border border-violet-500/35 px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none"
            title="Direct Messages"
          >
            <FiMessageSquare size={13} /> Chat
            {hasDmNotification && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
            )}
          </button>

          {showChatDropdown && (
            <>
              {/* Invisible Clickable Backdrop to close dropdown */}
              <div 
                className="fixed inset-0 z-40 bg-transparent"
                onClick={() => setShowChatDropdown(false)}
              />
              
              {/* DM Card */}
              <div className="absolute right-0 mt-2.5 w-[420px] sm:w-[480px] bg-[#131a26] border border-slate-800 rounded-2xl shadow-2xl p-4 z-50 text-left todo-chat-card animate-in fade-in slide-in-from-top-2 duration-150 flex gap-4 h-96">
                
                {/* Users List (Left Column, 35% width) */}
                <div className="w-1/3 border-r border-slate-800/80 pr-2 flex flex-col min-h-0">
                  <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Team Members</h4>
                  <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
                    {/* All Members (Group Chat option) */}
                    <button
                      type="button"
                      onClick={() => setSelectedRecipient("all")}
                      className={`w-full text-left px-2.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                        selectedRecipient === "all" 
                          ? "bg-violet-600 text-white" 
                          : "hover:bg-slate-900 text-slate-300"
                      }`}
                    >
                      <span className="truncate">All Members</span>
                    </button>

                    {users
                      .filter(u => u.username.toLowerCase() !== user?.username.toLowerCase())
                      .map(u => {
                        const hasUnreadFromThisUser = directMessages.some(dm => 
                          dm.sender.toLowerCase() === u.username.toLowerCase() && 
                          dm.recipient.toLowerCase() === user?.username.toLowerCase() && 
                          !dm.read
                        );
                        
                        return (
                          <button
                            key={u._id}
                            type="button"
                            onClick={() => handleSelectRecipient(u.username)}
                            className={`w-full text-left px-2.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                              selectedRecipient === u.username 
                                ? "bg-violet-600 text-white" 
                                : "hover:bg-slate-900 text-slate-300"
                            }`}
                          >
                            <span className="truncate capitalize">{u.username}</span>
                            {hasUnreadFromThisUser && (
                              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0 ml-1.5" />
                            )}
                          </button>
                        );
                      })}
                  </div>
                </div>

                {/* Messages Log (Right Column, 65% width) */}
                <div className="flex-1 flex flex-col min-h-0">
                  {selectedRecipient ? (
                    <>
                      {/* Recipient Header */}
                      <div className="pb-2 border-b border-slate-800/80 mb-2 flex justify-between items-center">
                        <span className="text-xs font-black uppercase tracking-wider text-slate-100 todo-chat-text-primary capitalize">
                          {selectedRecipient === "all" ? "Group Discussion" : `Chat with ${selectedRecipient}`}
                        </span>
                      </div>

                      {/* Message History */}
                      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar p-2 bg-slate-950/20 rounded-xl mb-2 flex flex-col">
                        {selectedRecipient === "all" ? (
                          chatMessages.length === 0 ? (
                            <div className="text-center my-auto text-slate-500 uppercase tracking-widest text-[9px] font-bold">
                              Start the group discussion!
                            </div>
                          ) : (
                            chatMessages.slice(-30).map((msg, index) => {
                              const isMe = msg.sender.toLowerCase() === user?.username.toLowerCase();
                              return (
                                <div key={msg._id || index} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                                  {!isMe && (
                                    <span className="text-[8px] text-slate-400 font-bold mb-0.5 capitalize">{msg.sender}</span>
                                  )}
                                  <div className={`p-2 rounded-xl text-xs max-w-[85%] break-words whitespace-pre-wrap ${
                                    isMe 
                                      ? "bg-violet-600 text-white rounded-tr-none text-right" 
                                      : "bg-slate-900 border border-slate-850 text-slate-200 rounded-tl-none todo-chat-chat-bubble"
                                  }`}>
                                    {msg.message}
                                  </div>
                                </div>
                              );
                            })
                          )
                        ) : (
                          directMessages.filter(dm => 
                            (dm.sender.toLowerCase() === user?.username.toLowerCase() && dm.recipient.toLowerCase() === selectedRecipient.toLowerCase()) ||
                            (dm.sender.toLowerCase() === selectedRecipient.toLowerCase() && dm.recipient.toLowerCase() === user?.username.toLowerCase())
                          ).length === 0 ? (
                            <div className="text-center my-auto text-slate-500 uppercase tracking-widest text-[9px] font-bold">
                              Say hello to {selectedRecipient}!
                            </div>
                          ) : (
                            directMessages
                              .filter(dm => 
                                (dm.sender.toLowerCase() === user?.username.toLowerCase() && dm.recipient.toLowerCase() === selectedRecipient.toLowerCase()) ||
                                (dm.sender.toLowerCase() === selectedRecipient.toLowerCase() && dm.recipient.toLowerCase() === user?.username.toLowerCase())
                              )
                              .map((dm, index) => {
                                const isMe = dm.sender.toLowerCase() === user?.username.toLowerCase();
                                return (
                                  <div key={dm._id || index} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                                    <div className={`p-2 rounded-xl text-xs max-w-[85%] break-words whitespace-pre-wrap ${
                                      isMe 
                                        ? "bg-violet-600 text-white rounded-tr-none text-right" 
                                        : "bg-slate-900 border border-slate-850 text-slate-200 rounded-tl-none todo-chat-chat-bubble"
                                    }`}>
                                      {dm.message}
                                    </div>
                                  </div>
                                );
                              })
                          )
                        )}
                      </div>

                      {/* Message Input Form */}
                      <form onSubmit={handleSendMessageSubmit} className="flex items-center gap-1.5 mt-auto">
                        <input
                          type="text"
                          placeholder={selectedRecipient === "all" ? "Broadcast to group..." : `Message ${selectedRecipient}...`}
                          value={newDmText}
                          onChange={(e) => setNewDmText(e.target.value)}
                          className="flex-1 bg-slate-950 border border-slate-855 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 todo-chat-input-wrapper font-bold"
                        />
                        <button 
                          type="submit"
                          className="bg-violet-600 hover:bg-violet-500 p-2 rounded-xl text-white transition-all shadow-md shadow-violet-600/20 flex-shrink-0 cursor-pointer"
                        >
                          <FiPlus size={14} />
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="text-center my-auto text-slate-500 uppercase tracking-widest text-[10px] font-bold">
                      Select a recipient
                    </div>
                  )}
                </div>

              </div>
            </>
          )}
        </div>

        {/* Workspace Dropdown Popover */}
        <div className="relative">
          <button 
            type="button"
            onClick={() => {
              setShowTodoDropdown(prev => !prev);
              setShowChatDropdown(false);
            }}
            className="relative text-[10px] md:text-xs font-black uppercase tracking-wider bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 border border-violet-500/35 px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none"
            title="Workspace To-Do List"
          >
            <FiCheckSquare size={13} /> Workspace
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
              
              {/* Dropdown Card */}
              <div className="absolute right-0 mt-2.5 w-80 sm:w-96 bg-[#131a26] border border-slate-800 rounded-2xl shadow-2xl p-4 z-50 text-left todo-chat-card animate-in fade-in slide-in-from-top-2 duration-150 flex flex-col">
                <div className="flex justify-between items-center pb-2.5 mb-3 border-b border-slate-800/80">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-100 todo-chat-text-primary flex items-center gap-1.5">
                    <FiCheckSquare className="text-violet-500" size={14} /> Team Tasks Checklist
                  </h3>
                  <Link 
                    href="/dashboard/todo-chat"
                    onClick={() => setShowTodoDropdown(false)}
                    className="text-[10px] font-black uppercase text-violet-400 hover:underline"
                  >
                    Open Workspace
                  </Link>
                </div>

                {/* Tasks List */}
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {todoTasks.filter(t => t.status === "Pending").length === 0 ? (
                    <div className="text-center py-6 text-slate-500 uppercase tracking-widest text-[10px] font-bold">
                      ✓ No pending tasks!
                    </div>
                  ) : (
                    todoTasks.filter(t => t.status === "Pending").map(task => (
                      <div 
                        key={task._id} 
                        className="flex items-start gap-2.5 p-2 bg-slate-950/40 hover:bg-slate-950/80 border border-slate-850 hover:border-violet-500/20 rounded-xl transition-all todo-chat-task-item"
                      >
                        <button 
                          type="button"
                          onClick={() => handleToggleTask(task._id, task.status)}
                          className="mt-0.5 text-slate-400 hover:text-emerald-500 transition-colors flex-shrink-0"
                        >
                          <FiSquare size={14} />
                        </button>
                        <div className="flex-1 min-w-0">
                          <span className="text-slate-100 font-bold block leading-snug break-words todo-chat-task-title text-xs">{task.title}</span>
                          {task.description && (
                            <p className="text-[10px] text-slate-400 mt-0.5 truncate leading-relaxed">{task.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            {task.assignedTo && (
                              <span className="text-[8px] font-black uppercase text-violet-400 bg-violet-500/10 px-1.5 py-0.2 rounded capitalize">
                                {task.assignedTo}
                              </span>
                            )}
                            <span className="text-[8px] text-slate-500 font-bold">By {task.createdBy}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Inline Add Task Form */}
                <form onSubmit={handleAddTask} className="relative mt-3.5 pt-3 border-t border-slate-800/80 flex items-center gap-2">
                  {showSuggestions && (
                    <div className="absolute bottom-full left-0 mb-1 w-full bg-[#131a26] border border-slate-800 rounded-xl shadow-2xl z-55 p-1 max-h-32 overflow-y-auto">
                      {filteredSuggestions.map(u => (
                        <button
                          key={u._id}
                          type="button"
                          onClick={() => handleSelectSuggestion(u.username)}
                          className="w-full text-left px-2.5 py-1.5 hover:bg-violet-600 hover:text-white rounded-lg text-[11px] font-bold text-slate-200 transition-colors cursor-pointer capitalize"
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
                    className="flex-1 bg-slate-950 border border-slate-855 rounded-xl py-2 px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 todo-chat-input-wrapper font-bold"
                  />
                  <button 
                    type="submit"
                    className="bg-violet-600 hover:bg-violet-500 p-2 rounded-xl text-white transition-all shadow-md shadow-violet-600/20 flex-shrink-0 cursor-pointer"
                    title="Quick Add Task"
                  >
                    <FiPlus size={14} />
                  </button>
                </form>
              </div>
            </>
          )}
        </div>

        <div className="text-right border-r border-slate-700 pr-4 md:pr-8">
          <h2 className="text-sm md:text-lg font-bold leading-none capitalize">{user.username}</h2>
        </div>

        {/* Theme Switcher Toggle */}
        <button 
          onClick={toggleTheme}
          className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 transition-all rounded-full cursor-pointer flex items-center justify-center"
          title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
        >
          {theme === "dark" ? <FiSun size={20} /> : <FiMoon size={20} />}
        </button>

        <button 
          onClick={handleLogout}
          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-all rounded-full cursor-pointer flex items-center justify-center"
          title="Logout"
        >
          <FiLogOut size={20} />
        </button>
      </div>
    </header>
  );
}