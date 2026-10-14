"use client";
import { useEffect, useRef, useState } from "react";
import { uploadMedia, uploadsEnabled } from "@/lib/media";
import { cleanProfile, validateProfile, mediaUrl, PROFILE_LIMITS, type Profile, type ProfileBody } from "@monsoc/sdk";
import { useSession, relay } from "@/lib/session";
import { errMsg } from "@/lib/format";
import { Avatar } from "./Avatar";

/** Edits the signed profile message. Saving signs a new `profile` message; the newest one wins everywhere. */

/** Banner color when a profile has no banner image. */
export const DEFAULT_BANNER = "var(--accent)";
export function ProfileEditor({
  profile,
  onSaved,
  onCancel,
  onHandleChanged,
}: {
  profile: Profile;
  onSaved: (p: Profile) => void;
  onCancel: () => void;
  onHandleChanged: (handle: string) => void;
}) {
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
        className="h-36 bg-cover bg-center"
        style={body.banner && !problems.some((p) => p.startsWith("banner")) ? { backgroundImage: `url("${mediaUrl(body.banner)}")` } : { backgroundColor: DEFAULT_BANNER }}
      />
      <div className="space-y-3 px-4 pb-4">
        <div className="-mt-10 rounded-full border-4 border-bg" style={{ width: 88 }}>
          <Avatar fid={profile.fid} handle={profile.handle} src={problems.some((p) => p.startsWith("avatar")) ? null : body.avatar} size={80} />
        </div>
        <HandleChanger current={profile.handle ?? ""} onChanged={onHandleChanged} />
        <Field label="Name" hint={`${form.displayName.length}/${PROFILE_LIMITS.displayName}`}>
          <input className="input" value={form.displayName} onChange={set("displayName")} maxLength={PROFILE_LIMITS.displayName} placeholder="Your name" />
        </Field>
        <Field label="Bio" hint={`${form.bio.length}/${PROFILE_LIMITS.bio}`}>
          <textarea className="input" rows={3} value={form.bio} onChange={set("bio")} maxLength={PROFILE_LIMITS.bio} placeholder="What you build, what you care about" />
        </Field>
        <Field label="Avatar image" hint="ipfs:// or https://">
          <div className="flex gap-2">
            <input className="input" value={form.avatar} onChange={set("avatar")} placeholder="https://…/me.jpg" />
            <ImageUpload onUploaded={(uri) => setForm((f) => ({ ...f, avatar: uri }))} onError={setErr} />
          </div>
        </Field>
        <Field label="Banner image" hint="ipfs:// or https://">
          <div className="flex gap-2">
            <input className="input" value={form.banner} onChange={set("banner")} placeholder="https://…/banner.jpg" />
            <ImageUpload onUploaded={(uri) => setForm((f) => ({ ...f, banner: uri }))} onError={setErr} />
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Website" hint="https://">
            <input className="input" value={form.url} onChange={set("url")} placeholder="https://yoursite.com" />
          </Field>
          <Field label="Location" hint={`${form.location.length}/${PROFILE_LIMITS.location}`}>
            <input className="input" value={form.location} onChange={set("location")} maxLength={PROFILE_LIMITS.location} placeholder="Bengaluru" />
          </Field>
        </div>
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

/** The handle is onchain and owner-only: changing it asks for the passkey (identity key), not the app key. */
function HandleChanger({ current, onChanged }: { current: string; onChanged: (h: string) => void }) {
  const { changeHandle } = useSession();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const next = value.toLowerCase();
  const valid = /^[a-z0-9_]{1,16}$/.test(next);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await changeHandle(next);
      onChanged(next);
    } catch (e) {
      const m = errMsg(e);
      setErr(/PRF/i.test(m) ? "This browser can't use your passkey (no PRF support). Try Safari or Chrome." : /NotAllowed|cancel/i.test(m) ? "Passkey prompt was cancelled." : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line p-3">
      <span className="mb-1 flex justify-between text-xs text-muted">
        <span>Handle</span>
        <span>onchain · 1-16 of a-z, 0-9, _</span>
      </span>
      <div className="flex gap-2">
        <div className="field flex-1">
          <span className="text-muted">@</span>
          <input
            className="flex-1 bg-transparent px-1 py-2 text-sm outline-none"
            value={value}
            maxLength={16}
            onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          />
        </div>
        <button className="btn-ghost" disabled={busy || !valid || next === current} onClick={submit}>
          {busy ? "Confirm with passkey…" : "Change handle"}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Asks for your passkey, since only the account owner can change it. Your old handle becomes available to others; followers and posts stay
        with you.
      </p>
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
    </div>
  );
}

/** Uploads one image to ImageKit and hands back its URL. Hidden when the relay has no media provider. */
function ImageUpload({ onUploaded, onError }: { onUploaded: (uri: string) => void; onError: (e: string | null) => void }) {
  const { fid, appKey } = useSession();
  const [enabled, setEnabled] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    uploadsEnabled().then(setEnabled);
  }, []);
  if (!enabled || !fid || !appKey) return null;

  const pick = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return onError("Pick an image file");
    onError(null);
    setProgress(0);
    try {
      onUploaded((await uploadMedia(file, fid, appKey, setProgress)).uri);
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" className="btn-ghost shrink-0" disabled={progress !== null} onClick={() => input.current?.click()}>
        {progress !== null ? `${Math.round(progress * 100)}%` : "Upload"}
      </button>
    </>
  );
}
