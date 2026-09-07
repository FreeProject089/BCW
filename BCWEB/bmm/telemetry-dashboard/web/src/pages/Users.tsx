import { useState } from "react";
import { Link } from "react-router-dom";
import { useStats } from "../lib/store";
import { Card, Empty, CsvButton } from "../components/ui";
import { ProfileAvatar, Flag } from "../components/visuals";
import { fmtDate, nf } from "../lib/format";
import { downloadCsv } from "../lib/csv";

export default function Users() {
  const s = useStats()!;
  const [q, setQ] = useState("");
  const rows = s.users.filter((u) => !q || u.creator_id.toLowerCase().includes(q.toLowerCase()) || (u.names || []).join(" ").toLowerCase().includes(q.toLowerCase()));

  const exportCsv = () => downloadCsv("bmm_users", rows, [
    { key: "creator_id", label: "Creator id" },
    { key: "name", label: "Name", get: (u) => u.names?.[0] || "" },
    { key: "country", label: "Country", get: (u) => u.country || "" },
    { key: "region", label: "Region", get: (u) => u.region || "" },
    { key: "os", label: "OS", get: (u) => u.config?.os || "" },
    { key: "version", label: "Version", get: (u) => u.versions?.[0] || "" },
    { key: "sessions", label: "Sessions" },
    { key: "first_seen", label: "First seen", get: (u) => fmtDate(u.first_seen) },
    { key: "last_seen", label: "Last seen", get: (u) => fmtDate(u.last_seen) },
  ]);

  return (
    <Card
      title={`Users · ${s.users.length}`}
      right={
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search creator id / name" className="bg-panel2 border border-line rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-brand" />
          <CsvButton onClick={exportCsv} />
        </div>
      }
    >
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Creator</th>
                <th className="th">Location</th>
                <th className="th">Device</th>
                <th className="th">Version</th>
                <th className="th text-right">Sessions</th>
                <th className="th text-right">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.creator_id} className="hover:bg-panel2">
                  <td className="td">
                    <Link to={`/users/${encodeURIComponent(u.creator_id)}`} className="flex items-center gap-3">
                      <ProfileAvatar name={u.creator_id} size={32} />
                      <div>
                        <div className="font-medium">{u.names?.[0] || "Anonymous"}</div>
                        <div className="font-mono text-[11px] text-sub">{u.creator_id}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="td"><Flag cc={u.cc} /> {u.country || "—"}{u.region ? `, ${u.region}` : ""}</td>
                  <td className="td text-sub">{u.config?.os || "—"}</td>
                  <td className="td text-sub">{u.versions?.[0] || "—"}</td>
                  <td className="td text-right">{nf(u.sessions)}</td>
                  <td className="td text-right text-sub">{fmtDate(u.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No users match.</Empty>
      )}
    </Card>
  );
}
