import { redirect } from "next/navigation";

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function RestRedirectPage({ searchParams }: PageProps) {
  const params = new URLSearchParams();

  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry != null) params.append(key, entry);
      });
      return;
    }
    if (value != null) params.set(key, value);
  });

  const query = params.toString();
  const target = query ? `/workout/exercise?${query}` : "/workout/exercise";

  redirect(target);
}
