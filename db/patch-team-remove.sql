-- =============================================================
-- 补丁：修复「移出团队」被 RLS 拒绝（403 new row violates ...）
-- 日期：2026-09-09
--
-- 现象：owner/admin 把成员移出团队（UPDATE profiles SET team_id = NULL）
--      报 new row violates row-level security；改角色正常。
-- 原因：库里的 profile_admin_update 的 WITH CHECK 带 team_id 条件，
--      而移除成员的新行 team_id 是 NULL，不满足 → with check 拒绝。
-- 修法：重建该策略，WITH CHECK 只校验操作者角色（owner/admin），
--      「新行 team_id 是什么」不该由这条策略管。
--
-- 在 Supabase Dashboard → SQL Editor 里整段粘贴运行一次即可。
-- =============================================================

drop policy if exists "profile_admin_update" on profiles;

create policy "profile_admin_update" on profiles
  for update to authenticated
  using (
    my_role() in ('owner', 'admin')
    and (team_id = my_team_id() or team_id is null)
  )
  with check (my_role() in ('owner', 'admin'));
