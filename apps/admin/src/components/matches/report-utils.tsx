import type React from "react";

export function parseReportToSections(content: string) {
  const sections: { title: string; body: string }[] = [];
  let currentTitle = "Podsumowanie";
  let currentBody: string[] = [];

  const lines = content.split("\n");
  for (const line of lines) {
    if (line.startsWith("## ") || line.startsWith("### ") || line.startsWith("# ")) {
      if (currentBody.length > 0 || currentTitle !== "Podsumowanie") {
        sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
      }
      currentTitle = line.replace(/^#+\s/, "");
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  if (currentBody.length > 0) {
    sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
  }

  return sections.filter((s) => s.body.length > 0);
}

export function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={match.index} className="font-semibold text-foreground/95">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={match.index}>{match[3]}</em>);
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts.length === 1 ? parts[0] : parts;
}

export function ReportSegment({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} className="flex items-start gap-2.5 pl-1.5 break-words">
              <span className="mt-2 block size-1.5 shrink-0 rounded-full bg-blue-500/50" />
              <span className="text-muted-foreground w-full break-words">{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(line)) {
          const match = line.match(/^(\d+)\.\s(.*)$/);
          if (match) {
            return (
              <div key={i} className="flex items-start gap-2 pl-1.5 break-words">
                <span className="font-medium text-foreground/60 shrink-0">{match[1]}.</span>
                <span className="text-muted-foreground w-full break-words">{renderInline(match[2])}</span>
              </div>
            );
          }
        }
        if (line.startsWith("---")) {
          return <hr key={i} className="my-3 border-border" />;
        }
        if (line.trim() === "") {
          return null; // Ignore extra blank lines inside segments to keep it compact
        }
        return (
          <p key={i} className="text-muted-foreground break-words">
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}
