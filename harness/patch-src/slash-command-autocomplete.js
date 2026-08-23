import { fuzzyFilter } from "./fuzzy.js";
const SKILL_COMMAND_PREFIX = "skill:";
function compareSlashCommandSuggestion(prefix, left, right) {
    const leftExact = left.value === prefix;
    const rightExact = right.value === prefix;
    if (leftExact !== rightExact)
        return leftExact ? -1 : 1;
    const leftPrefix = left.value.startsWith(prefix);
    const rightPrefix = right.value.startsWith(prefix);
    if (leftPrefix !== rightPrefix)
        return leftPrefix ? -1 : 1;
    if (leftPrefix && rightPrefix && left.value.length !== right.value.length) {
        return right.value.length - left.value.length;
    }
    return left.index - right.index;
}
export function getSlashCommandSuggestions(commands, prefix) {
    const normalizedPrefix = prefix.toLowerCase();
    const explicitSkillNamespace = normalizedPrefix.startsWith(SKILL_COMMAND_PREFIX);
    const hasSkillCommands = commands.some((cmd) => {
        const name = "name" in cmd ? cmd.name : cmd.value;
        return name.startsWith(SKILL_COMMAND_PREFIX);
    });
    const commandItems = commands.flatMap((cmd) => {
        const name = "name" in cmd ? cmd.name : cmd.value;
        const isSkill = name.startsWith(SKILL_COMMAND_PREFIX);
        const skillName = isSkill ? name.slice(SKILL_COMMAND_PREFIX.length) : "";
        if (isSkill &&
            !explicitSkillNamespace &&
            normalizedPrefix.length > 0 &&
            !skillName.toLowerCase().startsWith(normalizedPrefix)) {
            return [];
        }
        const hint = "argumentHint" in cmd && cmd.argumentHint ? cmd.argumentHint : undefined;
        const desc = cmd.description ?? "";
        const fullDesc = hint ? (desc ? `${hint} — ${desc}` : hint) : desc;
        return [
            {
                name,
                label: name,
                description: fullDesc || undefined,
                searchText: isSkill && !explicitSkillNamespace ? skillName : name,
            },
        ];
    });
    if (hasSkillCommands &&
        !explicitSkillNamespace &&
        normalizedPrefix.length > 0 &&
        SKILL_COMMAND_PREFIX.startsWith(normalizedPrefix)) {
        commandItems.push({
            name: SKILL_COMMAND_PREFIX,
            label: SKILL_COMMAND_PREFIX,
            description: "Browse available skills",
            searchText: SKILL_COMMAND_PREFIX,
        });
    }
    return fuzzyFilter(commandItems, prefix, (item) => item.searchText)
        .map((item, index) => ({
        value: item.name,
        label: item.label,
        ...(item.description && { description: item.description }),
        index,
    }))
        .sort((left, right) => compareSlashCommandSuggestion(normalizedPrefix, left, right))
        .map(({ index: _index, ...item }) => item);
}
//# sourceMappingURL=slash-command-autocomplete.js.map