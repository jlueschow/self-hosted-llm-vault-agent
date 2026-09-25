/**
 * Euridian — Wort-Diff (LCS). Geteilt von Inline-Edit und der Schreib-Bestätigung.
 */

/** Ein Diff-Segment auf Wortebene. */
export interface DiffSeg {
	type: "equal" | "add" | "del";
	text: string;
}

/** Zerlegt Text in Wörter inkl. Whitespace-Token (für stabilen Wort-Diff). */
function tokenize(s: string): string[] {
	return s.split(/(\s+)/).filter((t) => t.length > 0);
}

/**
 * Wort-Diff über LCS. Liefert zusammengefasste Segmente (equal/add/del).
 * Bei sehr großen Eingaben (Tabelle würde zu groß) wird auf „komplett ersetzt"
 * zurückgefallen, um die UI nicht zu blockieren.
 */
export function diffWords(a: string, b: string): DiffSeg[] {
	const A = tokenize(a);
	const B = tokenize(b);
	const n = A.length;
	const m = B.length;

	if (n * m > 4_000_000) {
		const segs: DiffSeg[] = [];
		if (a) segs.push({ type: "del", text: a });
		if (b) segs.push({ type: "add", text: b });
		return segs;
	}

	// LCS-Längentabelle (von hinten aufgebaut).
	const dp: number[][] = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0)
	);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] =
				A[i] === B[j]
					? dp[i + 1][j + 1] + 1
					: Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const segs: DiffSeg[] = [];
	const push = (type: DiffSeg["type"], text: string) => {
		const last = segs[segs.length - 1];
		if (last && last.type === type) last.text += text;
		else segs.push({ type, text });
	};

	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (A[i] === B[j]) {
			push("equal", A[i]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			push("del", A[i]);
			i++;
		} else {
			push("add", B[j]);
			j++;
		}
	}
	while (i < n) push("del", A[i++]);
	while (j < m) push("add", B[j++]);
	return segs;
}

/**
 * Rendert Diff-Segmente in ein Element (grün = neu, rot durchgestrichen = weg).
 * Erwartet die CSS-Klassen .euridian-diff-add / .euridian-diff-del.
 */
export function renderDiffInto(el: HTMLElement, segs: DiffSeg[]): void {
	for (const seg of segs) {
		if (seg.type === "equal") {
			el.createSpan({ text: seg.text });
		} else if (seg.type === "add") {
			el.createSpan({ cls: "euridian-diff-add", text: seg.text });
		} else {
			el.createSpan({ cls: "euridian-diff-del", text: seg.text });
		}
	}
}
