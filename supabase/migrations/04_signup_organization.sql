-- Give every new Supabase Auth user their own organization and store its id in
-- app_metadata.org_id, which the gateway reads from the access token.

create function public.provision_user_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_org_id uuid;
begin
    if new.raw_app_meta_data ? 'org_id' then
        return new;
    end if;

    insert into public.organizations (name, slug)
    values (
        coalesce(
            nullif(new.raw_user_meta_data ->> 'company_name', ''),
            split_part(new.email, '@', 1),
            'Veltra workspace'
        ),
        'org-' || replace(new.id::text, '-', '')
    )
    returning id into new_org_id;

    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('org_id', new_org_id::text)
    where id = new.id;

    return new;
end;
$$;

create trigger auth_users_provision_organization
after insert on auth.users
for each row execute function public.provision_user_organization();

-- Existing users created before this migration get an organization too.
do $$
declare
    user_row record;
    new_org_id uuid;
begin
    for user_row in
        select id, email, raw_user_meta_data
        from auth.users
        where not (coalesce(raw_app_meta_data, '{}'::jsonb) ? 'org_id')
    loop
        insert into public.organizations (name, slug)
        values (
            coalesce(
                nullif(user_row.raw_user_meta_data ->> 'company_name', ''),
                split_part(user_row.email, '@', 1),
                'Veltra workspace'
            ),
            'org-' || replace(user_row.id::text, '-', '')
        )
        returning id into new_org_id;

        update auth.users
        set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
            || jsonb_build_object('org_id', new_org_id::text)
        where id = user_row.id;
    end loop;
end;
$$;
