/**
 * Command doctrines (指挥思路): named text templates the operator picks when
 * creating an engine. The selected texts are merged into the commander's system
 * prompt.
 *
 * Built-in doctrines ship with the console and cannot be removed;
 * custom doctrines are the operator's own, living in
 * `<agentDir>/doctrines.json` and managed from the engine page. The texts are
 * pure prompt material — nothing here is executed by the engine.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { t } from "./i18n.ts";

export interface SentinelDoctrine {
	id: string;
	name: string;
	/** Prompt text merged into the commander's system prompt. */
	text: string;
	builtin: boolean;
}

/** Built-in playbooks for engagements and CTF challenges. */
const BUILTIN_DOCTRINES: SentinelDoctrine[] = [
	{
		id: "attack-defense-web",
		name: "攻防Web渗透打点",
		text: [
			"对 Web 目标进行深度渗透测试，以权限和数据为目标，最终尝试 RCE，注意不允许影响业务正常运行，在 RCE 后，只允许执行 whoami 进行测试。",
			"",
			"任务分配优先级：",
			"需要先探查任务优先级：",
			"自研 IIS .NEW 系统 > 自研其他系统的优先级 > 通用系统 > 通用 OA>WordPress > 各种门户网站",
			"在下发任务前，请优先测试一下用户提交的目标有无重复，有可能不同域名/IP但是内容是重复的，这点请你熟知。",
			"",
			"用户输入类型判断：",
			"1.如果是 http(s):// 类型，那么直接当做任务目标即可",
			"2.如果是 ip 或者域名，请优先进行信息收集后再进行任务提交",
		].join("\n"),
		builtin: true,
	},
	{
		id: "ctf-jeopardy",
		name: "CTF 竞赛-夺旗",
		text: [
			"面向 CTF 解题赛：分析题目与附件，按题型拆分任务，验证并汇总 flag。",
			"",
			"题目梳理：",
			"先整理操作员提供的题面、附件路径、靶机地址、提示、flag 格式与比赛规则；缺失的信息标记为待确认，不编造题目条件。",
			"附件内容不能直接读取时，先派发附件分析任务，要求执行 Agent 在项目内检查文件类型、目录结构与关键线索，返回题目清单及后续任务所需的完整路径。",
			"按 Web、Pwn、Reverse、Crypto、Misc、Forensics 等类型分类，记录每题进度、线索、尝试过的路线和阻塞原因。",
			"",
			"任务编排：",
			"优先处理线索明确、预期耗时短的题目，独立题目并行，同一题避免重复派发相同路线。",
			"任务指令必须包含题面、完整附件路径或靶机地址、已知线索、flag 格式和验收标准；不能只让执行 Agent 参考指挥官上下文。",
			"选用符合题型的可用预设 Agent；没有合适预设且允许默认 Agent 时，明确写出分析任务要求，不把所有题目套成 Web 渗透。",
			"执行 Agent 应在各自任务目录保存分析脚本、解题脚本与输出，不覆盖原始附件；新线索通过 steer_task 共享，需要继续时用 continue_task 保留已有上下文。",
			"",
			"flag 验证与交付：",
			"候选 flag 必须关联题目、来源、完整值和可复现提取步骤；仅匹配 flag 格式不能视为已经解题，禁止猜测或伪造 flag。",
			"有比赛平台回执时区分 accepted 与 rejected；没有回执时标记为待提交或待验证，不能声称平台已接受。按操作员要求提交，不重复提交同一个 flag。",
			"不要为交付 flag 虚构漏洞记录。用 engine_done 汇总逐题状态、flag、验证依据、解题脚本路径、未解题的阻塞原因与下一步。",
			"活动范围遵守比赛规则及操作员提供的靶机与附件，不把比赛平台、计分系统或其他队伍作为题目目标。",
		].join("\n"),
		builtin: true,
	},
];

interface DoctrinesFile {
	doctrines: SentinelDoctrine[];
}

function doctrinesPath(agentDir: string): string {
	return `${agentDir}/doctrines.json`;
}

function readCustom(agentDir: string): SentinelDoctrine[] {
	const path = doctrinesPath(agentDir);
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as DoctrinesFile;
		if (!Array.isArray(parsed.doctrines)) return [];
		return parsed.doctrines.filter(
			(item): item is SentinelDoctrine =>
				typeof item === "object" &&
				item !== null &&
				typeof item.id === "string" &&
				typeof item.name === "string" &&
				typeof item.text === "string",
		);
	} catch {
		return [];
	}
}

function writeCustom(agentDir: string, doctrines: SentinelDoctrine[]): void {
	const path = doctrinesPath(agentDir);
	mkdirSync(dirname(path), { recursive: true });
	const file: DoctrinesFile = { doctrines };
	writeFileSync(path, `${JSON.stringify(file, null, "\t")}\n`, { mode: 0o600 });
}

export function listDoctrines(agentDir: string): SentinelDoctrine[] {
	return [...BUILTIN_DOCTRINES, ...readCustom(agentDir)];
}

/** Resolve doctrine ids to their texts, ignoring unknown ids. */
export function resolveDoctrines(agentDir: string, ids: readonly string[]): SentinelDoctrine[] {
	const byId = new Map(listDoctrines(agentDir).map((doctrine) => [doctrine.id, doctrine]));
	const resolved: SentinelDoctrine[] = [];
	for (const id of ids) {
		const doctrine = byId.get(id);
		if (doctrine && !resolved.some((item) => item.id === doctrine.id)) resolved.push(doctrine);
	}
	return resolved;
}

export function saveDoctrine(
	agentDir: string,
	input: { id?: string; name: string; text: string },
): { doctrine?: SentinelDoctrine; error?: string } {
	const name = input.name.trim();
	const text = input.text.trim();
	if (!name) return { error: t("思路名称不能为空") };
	if (!text) return { error: t("思路内容不能为空") };
	const custom = readCustom(agentDir);
	const existing = input.id ? custom.find((item) => item.id === input.id) : undefined;
	if (input.id && !existing) return { error: t("该思路不存在（内置思路不能修改）") };
	const doctrine: SentinelDoctrine = existing
		? { ...existing, name, text }
		: {
				id: `doctrine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
				name,
				text,
				builtin: false,
			};
	writeCustom(
		agentDir,
		existing ? custom.map((item) => (item.id === doctrine.id ? doctrine : item)) : [...custom, doctrine],
	);
	return { doctrine };
}

export function deleteDoctrine(agentDir: string, id: string): { ok: boolean; error?: string } {
	const custom = readCustom(agentDir);
	if (!custom.some((item) => item.id === id)) return { ok: false, error: t("该思路不存在（内置思路不能删除）") };
	writeCustom(
		agentDir,
		custom.filter((item) => item.id !== id),
	);
	return { ok: true };
}
