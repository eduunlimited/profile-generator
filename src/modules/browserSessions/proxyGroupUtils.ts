import type { ProxyGroup } from "./types";

export const PROXY_UNCATEGORIZED_GROUP_ID = "proxy-uncategorized";

export function createUncategorizedProxyGroup(): ProxyGroup {
  return {
    id: PROXY_UNCATEGORIZED_GROUP_ID,
    name: "Uncategorized",
    createdAt: new Date(0).toISOString(),
  };
}

export function sortProxyGroups(groups: ProxyGroup[]): ProxyGroup[] {
  return [...groups].sort((left, right) => {
    const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (left.id === PROXY_UNCATEGORIZED_GROUP_ID) return -1;
    if (right.id === PROXY_UNCATEGORIZED_GROUP_ID) return 1;
    return left.name.localeCompare(right.name);
  });
}

export function nextProxyGroupSortOrder(groups: ProxyGroup[]): number {
  let max = -1;
  for (const group of groups) {
    if (group.sortOrder != null && group.sortOrder > max) {
      max = group.sortOrder;
    }
  }
  return max + 1;
}

export function proxyGroupLabel(groups: ProxyGroup[], groupId: string | undefined): string {
  const id = groupId || PROXY_UNCATEGORIZED_GROUP_ID;
  return groups.find((group) => group.id === id)?.name ?? "Uncategorized";
}
