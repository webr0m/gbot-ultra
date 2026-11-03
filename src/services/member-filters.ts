export const MEMBER_FILTERS = ["all", "admins", "restricted", "warned", "kicked"] as const;
export type MemberFilter = (typeof MEMBER_FILTERS)[number];

export function filterMemberPage<T extends { status: string; warns: number }>(all: T[], filter: MemberFilter, offset: number, limit: number) {
  const groups = {
    all,
    admins: all.filter(member => member.status === "creator" || member.status === "administrator"),
    restricted: all.filter(member => member.status === "restricted"),
    warned: all.filter(member => member.warns > 0),
    kicked: all.filter(member => member.status === "kicked" || member.status === "left"),
  };
  const filtered = groups[filter];
  return {
    total: filtered.length,
    counts: Object.fromEntries(Object.entries(groups).map(([name, list]) => [name, list.length])),
    hasMore: offset + limit < filtered.length,
    members: filtered.slice(offset, offset + limit),
  };
}
