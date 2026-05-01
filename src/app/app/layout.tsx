export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="dark" className="min-h-screen bg-[#0a0a0c] text-[#f5f5f7]">
      {children}
    </div>
  );
}
