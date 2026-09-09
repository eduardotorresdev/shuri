/**
 * Records per page, for every list the admin draws.
 *
 * One constant rather than one per screen: the pager, the `limit` a load asks for and the `+ 1` that
 * tells it there is a next page all have to agree, and they agree across screens too — a collection
 * and the users list that page differently would be a difference nobody chose.
 */
export const PAGE_SIZE = 25;
