export type Member = { id: string; username: string; avatarKey: string | null };
export type User = Member & { role: string };
export type Feed = { id: string; name: string; description: string; role: string; unread: number };
export type Me = { user: User; feeds: Feed[]; unreadNotifications: number; unreadShares: number };
export type Post = {
  id: string; caption: string; createdAt: string; author: Member;
  feed: { id: string; name: string }; latitude: number | null; longitude: number | null; locationName: string | null;
  liked: boolean; likeCount: number;
  media: { key: string; mimeType: string }[];
  comments: { id: string; text: string; createdAt: string; author: Member }[];
};
export type PostPage = { posts: Post[]; hasMore: boolean; profile?: Member };
export type TabParams = { Home: undefined; Post: undefined; Map: undefined; Search: undefined };
export type StackParams = {
  Login: undefined; Register: { token?: string } | undefined; Tabs: NavigatorScreenParams<TabParams> | undefined;
  Post: { id: string }; Profile: { username: string }; Notifications: undefined;
  Shared: undefined; Settings: undefined; Feeds: undefined; Feed: { id: string; name: string }; Admin: undefined;
};
import type { NavigatorScreenParams } from "@react-navigation/native";
