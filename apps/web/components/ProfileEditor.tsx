"use client";
import { useState } from "react";
import { cleanProfile, validateProfile, mediaUrl, PROFILE_LIMITS, type Profile, type ProfileBody } from "@monsoc/sdk";
import { useSession, relay } from "@/lib/session";
import { errMsg } from "@/lib/format";
import { Avatar } from "./Avatar";

/** Edits the signed profile message. Saving signs a new `profile` message; the newest one wins everywhere. */
export function ProfileEditor({ profile, onSaved, onCancel }: { profile: Profile; onSaved: (p: Profile) => void; onCancel: () => void }) {
  const { send } = useSession();
  const [form, setForm] = useState<Required<ProfileBody>>({
    displayName: profile.displayName ?? "",
    bio: profile.bio ?? "",
    avatar: profile.avatar ?? "",
    banner: profile.banner ?? "",
    url: profile.url ?? "",
    location: profile.location ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const body = cleanProfile(form);
  const problems = validateProfile(body);
  const set = (k: keyof ProfileBody) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await send("profile", body);
      onSaved(await relay.user(profile.fid));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-line">
      <div
        className="h-32 bg-gradient-to-br from-accent-soft to-panel-2 bg-cover bg-center"
        style={body.banner && !problems.some((p) => p.startsWith("banner")) ? { backgroundImage: `url("${mediaUrl(body.banner)}")` } : undefined}
      />
      <div className="space-y-3 px-4 pb-4">
        <div className="-mt-10 rounded-full border-4 border-bg" style={{ width: 88 }}>
          <Avatar fid={profile.fid} handle={profile.handle} src={problems.some((p) => p.startsWith("avatar")) ? null : body.avatar} size={80} />
        </div>
        <Field label="Name" hint={`${form.displayName.length}/${PROFILE_LIMITS.displayName}`}>
          <input className="input" value={form.displayName} onChange={set("displayName")} maxLength={PROFILE_LIMITS.displayName} placeholder="Your name" />
        </Field>
        <Field label="Bio" hint={`${form.bio.length}/${PROFILE_LIMITS.bio}`}>
          <textarea className="input" rows={3} value={form.bio} onChange={set("bio")} maxLength={PROFILE_LIMITS.bio} placeholder="What you build, what you care about" />
        </Field>
        <Field label="Avatar image" hint="ipfs:// or https://">
          <input className="input" value={form.avatar} onChange={set("avatar")} placeholder="https://…/me.jpg" />
        </Field>
        <Field label="Banner image" hint="ipfs:// or https://">
          <input className="input" value={form.banner} onChange={set("banner")} placeholder="https://…/banner.jpg" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Website" hint="https://">
            <input className="input" value={form.url} onChange={set("url")} placeholder="https://yoursite.com" />
          </Field>
          <Field label="Location" hint={`${form.location.length}/${PROFILE_LIMITS.location}`}>
            <input className="input" value={form.location} onChange={set("location")} maxLength={PROFILE_LIMITS.location} placeholder="Bengaluru" />
          </Field>
        </div>
        <p className="text-xs text-muted">Your @{profile.handle} is onchain and isn't changed here.</p>
        {problems.length > 0 && <p className="text-xs text-bad">{problems.join(" · ")}</p>}
        {err && <p className="text-xs text-bad">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={busy || problems.length > 0} onClick={save}>{busy ? "Signing…" : "Save profile"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs text-muted">
        <span>{label}</span>
        {hint && <span>{hint}</span>}
      </span>
      {children}
    </label>
  );
}
