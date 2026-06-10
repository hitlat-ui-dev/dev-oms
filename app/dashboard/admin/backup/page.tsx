"use client";
import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { FiDownload, FiDatabase, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';

export default function BackupPage() {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({
        type: null,
        message: ''
    });
const [loginUser, setLoginUser] = useState<string>("");

  useEffect(() => {
    const session = localStorage.getItem("oms_user");
    const userData = session ? JSON.parse(session) : null;
    setLoginUser(userData?.username || "Unknown User");
  }, []);
    const handleDownloadBackup = async () => {
        if (loading) return; // Prevent double clicks entirely
        setLoading(true);
        setStatus({ type: null, message: '' });

        try {
            // 1. Pull raw data fields across your collection infrastructure arrays
            const response = await fetch('/api/backup');
            if (!response.ok) throw new Error('Failed to fetch backup collections data from server pipeline.');

            const data = await response.json();
            const { collections, database, timestamp } = data;

            // 2. Initialize JSZip engine compression system instantiations
            const zip = new JSZip();
            const dateStub = timestamp.split('T')[0];
            const folderName = `${database}_backup_${dateStub}`;
            const backupFolder = zip.folder(folderName);

            if (!backupFolder) throw new Error('Failed to initialize download container folder.');

            // 3. Inject separate formatted JSON data documents into the zip tree loop
            Object.keys(collections).forEach((collectionName) => {
                const fileContent = JSON.stringify(collections[collectionName], null, 2);
                backupFolder.file(`${collectionName}.json`, fileContent);
            });

            // 4. Generate the final zip file binary format blob payload
            const contentBlob = await zip.generateAsync({ type: 'blob' });

            // 5. Trigger an automatic download link in the browser window view
            const downloadUrl = window.URL.createObjectURL(contentBlob);
            const tempLink = document.createElement('a');
            tempLink.href = downloadUrl;
            tempLink.download = `${folderName}.zip`;

            document.body.appendChild(tempLink);
            tempLink.click();

            // Cleanup browser cache resources cleanly
            document.body.removeChild(tempLink);
            window.URL.revokeObjectURL(downloadUrl);

            setStatus({
                type: 'success',
                message: `Database "${database}" successfully archived! Download completed with ${Object.keys(collections).length} collection files.`
            });

        } catch (err: any) {
            console.error(err);
            setStatus({
                type: 'error',
                message: err.message || 'An error occurred while compiling your backup archive zip data.'
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            {loginUser === "Chintan" ? (
                <>
                    <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
                        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 shadow-xl">

                            {/* Header Icon Block */}
                            <div className="flex items-center gap-4 mb-6">
                                <div className="bg-blue-50 p-4 rounded-xl text-blue-600">
                                    <FiDatabase size={28} />
                                </div>
                                <div>
                                    <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">System Data Backup</h1>
                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Secure MongoDB Cloud Storage Dump</p>
                                </div>
                            </div>

                            <hr className="border-slate-100 mb-6" />

                            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
                                Clicking the backup button will download all active collections (products, vendors, companies, orders, and stocks) as separate readable JSON files compiled inside a single compressed `.zip` backup archive folder.
                            </p>

                            {/* Dynamic Warning/Success Notifications */}
                            {status.type === 'success' && (
                                <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3 text-emerald-800 text-xs font-bold leading-normal">
                                    <FiCheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                                    <span>{status.message}</span>
                                </div>
                            )}

                            {status.type === 'error' && (
                                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800 text-xs font-bold leading-normal">
                                    <FiAlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                                    <span>{status.message}</span>
                                </div>
                            )}

                            {/* 🚀 BACKUP TRIGGER UTILITY ACTION BUTTON */}
                            <button
                                type="button"
                                disabled={loading}
                                onClick={handleDownloadBackup}
                                className="w-full flex items-center justify-center gap-3 bg-slate-900 text-white font-black uppercase text-xs tracking-widest py-4 rounded-xl transition-all active:scale-[0.98] disabled:opacity-40 cursor-pointer shadow-lg shadow-slate-200 hover:bg-slate-800"
                            >
                                {loading ? (
                                    <>
                                        <svg className="animate-spin h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        <span>Compiling ZIP Archive...</span>
                                    </>
                                ) : (
                                    <>
                                        <FiDownload size={16} />
                                        <span>Download Full Backup JSON Zip</span>
                                    </>
                                )}
                            </button>

                        </div>
                    </div>
                </>
            ) : (
                <></>
            )};
        </div>
    );
}