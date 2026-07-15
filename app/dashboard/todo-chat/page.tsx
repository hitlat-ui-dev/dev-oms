"use client";
import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  FiCheckSquare, 
  FiSquare, 
  FiTrash2, 
  FiCalendar, 
  FiClock, 
  FiUser, 
  FiSend, 
  FiPlus, 
  FiArrowLeft,
  FiMessageSquare,
  FiFilter,
  FiList
} from "react-icons/fi";

interface Task {
  _id: string;
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  reminder: string;
  status: "Pending" | "Completed";
  createdBy: string;
  createdAt: string;
}

interface ChatMessage {
  _id: string;
  sender: string;
  message: string;
  createdAt: string;
}

interface User {
  username: string;
}

export default function TodoChatPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<string>("Admin");
  
  // Tasks state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [reminder, setReminder] = useState("");
  const [taskFilter, setTaskFilter] = useState<"all" | "my" | "pending" | "completed">("all");
  const [isAddingTaskExpanded, setIsAddingTaskExpanded] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  
  // Users list state
  const [users, setUsers] = useState<User[]>([]);
  
  // Loading state
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingChat, setLoadingChat] = useState(true);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Authenticate & Load initial data
  useEffect(() => {
    const session = localStorage.getItem("oms_user");
    if (!session) {
      router.push("/login");
      return;
    }
    try {
      const parsed = JSON.parse(session);
      if (parsed.username) {
        setCurrentUser(parsed.username);
      }
    } catch (e) {
      router.push("/login");
    }

    // Load initial data
    fetchTasks();
    fetchChat();
    fetchUsers();

    // Poll for new tasks & chat messages every 4 seconds for real-time feel
    const interval = setInterval(() => {
      pollTasks();
      pollChat();
    }, 4000);

    return () => clearInterval(interval);
  }, [router]);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/todo");
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingTasks(false);
    }
  };

  const pollTasks = async () => {
    try {
      const res = await fetch("/api/todo");
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchChat = async () => {
    try {
      const res = await fetch("/api/chat");
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingChat(false);
    }
  };

  const pollChat = async () => {
    try {
      const res = await fetch("/api/chat");
      if (res.ok) {
        const data = await res.json();
        // Only update if message count or last message ID changes
        if (data.length !== chatMessages.length || (data.length > 0 && data[data.length - 1]._id !== chatMessages[chatMessages.length - 1]?._id)) {
          setChatMessages(data);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

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

  // Add a task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    try {
      const res = await fetch("/api/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDesc,
          assignedTo,
          dueDate,
          reminder,
          createdBy: currentUser
        })
      });

      if (res.ok) {
        const result = await res.json();
        setTasks(prev => [result.task, ...prev]);
        
        // Reset form
        setTaskTitle("");
        setTaskDesc("");
        setAssignedTo("");
        setDueDate("");
        setReminder("");
        setIsAddingTaskExpanded(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Toggle task status
  const handleToggleStatus = async (task: Task) => {
    const newStatus = task.status === "Pending" ? "Completed" : "Pending";
    
    // Optimistic UI update
    setTasks(prev => prev.map(t => t._id === task._id ? { ...t, status: newStatus } : t));

    try {
      await fetch(`/api/todo/${task._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
    } catch (e) {
      console.error(e);
      // Revert if error
      setTasks(prev => prev.map(t => t._id === task._id ? { ...t, status: task.status } : t));
    }
  };

  // Delete task
  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;

    // Optimistic UI update
    setTasks(prev => prev.filter(t => t._id !== taskId));

    try {
      await fetch(`/api/todo/${taskId}`, { method: "DELETE" });
    } catch (e) {
      console.error(e);
      fetchTasks(); // Reload on error
    }
  };

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const msgText = newMessage;
    setNewMessage("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: currentUser,
          message: msgText
        })
      });

      if (res.ok) {
        const result = await res.json();
        setChatMessages(prev => [...prev, result.message]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Filters calculation
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (taskFilter === "completed") return t.status === "Completed";
      if (taskFilter === "pending") return t.status === "Pending";
      if (taskFilter === "my") return t.assignedTo?.toLowerCase() === currentUser.toLowerCase();
      return true;
    });
  }, [tasks, taskFilter, currentUser]);

  const getUserInitials = (name: string) => {
    if (!name) return "?";
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="p-4 md:p-8 bg-[#0f172a] min-h-screen text-slate-100 font-sans todo-chat-container">
      <div className="max-w-7xl mx-auto flex flex-col gap-6 h-[calc(100vh-140px)]">
        
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-slate-800">
          <div>
            <Link href="/dashboard" className="flex items-center gap-2 text-slate-400 hover:text-white text-xs mb-1 transition-colors">
              <FiArrowLeft /> Back to Dashboard
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
              <FiCheckSquare className="text-violet-500" /> Team Workspace
            </h1>
            <p className="text-slate-400 text-[10px] uppercase font-bold tracking-widest mt-0.5">Tasks & Live Discussion Hub</p>
          </div>
        </div>

        {/* Dual-Pane Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
          
          {/* LEFT PANEL: Task management (7 cols) */}
          <div className="lg:col-span-7 bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col min-h-0 backdrop-blur-sm shadow-xl todo-chat-card">
            
            {/* Task Filters */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 todo-chat-filter-bg">
                <button
                  onClick={() => setTaskFilter("all")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all todo-chat-filter-btn ${
                    taskFilter === "all" ? "active bg-violet-600 text-white shadow-md shadow-violet-600/20" : "text-slate-400 hover:text-white"
                  }`}
                >
                  All Tasks
                </button>
                <button
                  onClick={() => setTaskFilter("my")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all todo-chat-filter-btn ${
                    taskFilter === "my" ? "active bg-violet-600 text-white shadow-md shadow-violet-600/20" : "text-slate-400 hover:text-white"
                  }`}
                >
                  My Tasks
                </button>
                <button
                  onClick={() => setTaskFilter("pending")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all todo-chat-filter-btn ${
                    taskFilter === "pending" ? "active bg-violet-600 text-white shadow-md shadow-violet-600/20" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setTaskFilter("completed")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all todo-chat-filter-btn ${
                    taskFilter === "completed" ? "active bg-violet-600 text-white shadow-md shadow-violet-600/20" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Completed
                </button>
              </div>
            </div>

            {/* Microsoft To-Do style Task Input */}
            <form onSubmit={handleCreateTask} className="mb-4 bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden p-3 transition-all duration-200 todo-chat-input-wrapper">
              <div className="flex items-center gap-2">
                <button type="submit" className="p-1.5 text-slate-400 hover:text-violet-500 transition-colors">
                  <FiPlus size={18} />
                </button>
                <input
                  type="text"
                  placeholder="Add a new task..."
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  onFocus={() => setIsAddingTaskExpanded(true)}
                  className="bg-transparent border-none text-xs text-white focus:outline-none flex-1 font-bold"
                />
              </div>

              {/* Collapsible Details Pane */}
              {isAddingTaskExpanded && (
                <div className="mt-3 pt-3 border-t border-slate-800/60 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <textarea
                    placeholder="Add description or notes..."
                    value={taskDesc}
                    onChange={(e) => setTaskDesc(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-300 focus:outline-none focus:border-violet-500 h-16 resize-none"
                  />
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {/* Assigned To selection */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">Assign To</label>
                      <select
                        value={assignedTo}
                        onChange={(e) => setAssignedTo(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none"
                      >
                        <option value="">Unassigned</option>
                        {users.map(u => (
                          <option key={u.username} value={u.username}>{u.username}</option>
                        ))}
                      </select>
                    </div>

                    {/* Due Date picker */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">Due Date</label>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none"
                      />
                    </div>

                    {/* Reminder picker */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">Set Reminder</label>
                      <input
                        type="datetime-local"
                        value={reminder}
                        onChange={(e) => setReminder(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsAddingTaskExpanded(false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider text-slate-400 hover:bg-slate-900"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="bg-violet-600 hover:bg-violet-500 px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider text-white shadow-md shadow-violet-600/20"
                    >
                      Add Task
                    </button>
                  </div>
                </div>
              )}
            </form>

            {/* Task list container */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1.5 custom-scrollbar">
              {loadingTasks ? (
                <div className="flex justify-center items-center py-10">
                  <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-violet-500"></div>
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="text-center py-12 text-slate-500 space-y-2">
                  <FiList className="mx-auto text-2xl text-slate-600 animate-pulse" />
                  <p className="text-xs uppercase font-black tracking-widest">No tasks found</p>
                </div>
              ) : (
                filteredTasks.map(task => {
                  const isCompleted = task.status === "Completed";
                  return (
                    <div
                      key={task._id}
                      className={`group flex items-start justify-between p-3.5 rounded-xl border transition-all duration-200 todo-chat-task-item ${
                        isCompleted 
                          ? "completed bg-slate-950/20 border-slate-900/60 opacity-60" 
                          : "bg-slate-950/60 hover:bg-slate-950/80 border-slate-800/80 hover:border-violet-500/20"
                      }`}
                    >
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {/* Custom checkbox */}
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(task)}
                          className="mt-0.5 text-slate-400 hover:text-violet-500 transition-colors flex-shrink-0"
                        >
                          {isCompleted ? (
                            <FiCheckSquare className="text-emerald-500" size={17} />
                          ) : (
                            <FiSquare size={17} />
                          )}
                        </button>
                        
                        <div className="flex-1 min-w-0">
                          <span className={`text-xs font-bold block todo-chat-task-title ${isCompleted ? "line-through text-slate-500" : "text-slate-100"}`}>
                            {task.title}
                          </span>
                          
                          {task.description && (
                            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed max-w-lg whitespace-pre-wrap">{task.description}</p>
                          )}

                          {/* Task details bar */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
                            {task.assignedTo && (
                              <span className="inline-flex items-center gap-1.5 bg-violet-600/10 border border-violet-500/20 text-violet-400 text-[10px] font-black tracking-wide uppercase px-2 py-0.5 rounded-md">
                                <FiUser size={10} /> {task.assignedTo}
                              </span>
                            )}
                            
                            {task.dueDate && (
                              <span className="inline-flex items-center gap-1.5 bg-amber-600/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                <FiCalendar size={10} /> {task.dueDate}
                              </span>
                            )}

                            {task.reminder && (
                              <span className="inline-flex items-center gap-1.5 bg-emerald-600/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                <FiClock size={10} /> {new Date(task.reminder).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                              </span>
                            )}

                            <span className="text-[9px] font-bold text-slate-500">
                              By {task.createdBy}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Delete Action button */}
                      <button
                        onClick={() => handleDeleteTask(task._id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-500 transition-all rounded hover:bg-slate-900/60 ml-2"
                        title="Delete Task"
                      >
                        <FiTrash2 size={13} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT PANEL: Live Group Chat (5 cols) */}
          <div className="lg:col-span-5 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col min-h-0 backdrop-blur-sm shadow-xl overflow-hidden todo-chat-card">
            
            {/* Chat header */}
            <div className="p-4 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FiMessageSquare className="text-violet-500" />
                <h2 className="text-xs font-black uppercase tracking-wider text-slate-200">Team Discussion</h2>
              </div>
              <span className="bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full animate-pulse">
                Live Channel
              </span>
            </div>

            {/* Chat Messages Log */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-950/20">
              {loadingChat ? (
                <div className="flex justify-center items-center h-full">
                  <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-violet-500"></div>
                </div>
              ) : chatMessages.length === 0 ? (
                <div className="flex flex-col justify-center items-center h-full text-slate-600 space-y-1">
                  <FiMessageSquare size={32} className="text-slate-700" />
                  <p className="text-xs uppercase font-black tracking-widest text-slate-500">No messages yet</p>
                  <p className="text-[10px] text-slate-600">Start the conversation below!</p>
                </div>
              ) : (
                chatMessages.map((msg, index) => {
                  const isMe = msg.sender.toLowerCase() === currentUser.toLowerCase();
                  
                  return (
                    <div key={msg._id || index} className={`flex items-start gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}>
                      {/* Avatar */}
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black border text-white select-none todo-chat-avatar ${
                        isMe ? "todo-chat-avatar-me bg-violet-600 border-violet-500" : "bg-slate-800 border-slate-700"
                      }`}>
                        {getUserInitials(msg.sender)}
                      </div>

                      {/* Bubble */}
                      <div className="max-w-[75%] space-y-0.5">
                        <div className={`flex items-center gap-1.5 text-[9px] text-slate-500 font-bold ${isMe ? "justify-end" : ""}`}>
                          <span className="capitalize text-slate-400">{msg.sender}</span>
                          <span>•</span>
                          <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className={`p-3 rounded-2xl text-xs leading-relaxed break-words whitespace-pre-wrap todo-chat-chat-bubble ${
                          isMe 
                            ? "todo-chat-chat-bubble-me bg-violet-600 text-white rounded-tr-none shadow-md shadow-violet-600/10" 
                            : "bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none"
                        }`}>
                          {msg.message}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input area */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-800 bg-slate-950/40 flex items-center gap-2">
              <input
                type="text"
                placeholder="Type your message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl py-2 px-3.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                className="bg-violet-600 hover:bg-violet-500 p-2 rounded-xl text-white transition-all shadow-md shadow-violet-600/20"
                title="Send Message"
              >
                <FiSend size={14} />
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}
