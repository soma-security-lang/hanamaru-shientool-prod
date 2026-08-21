CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_key varchar(100) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  timezone varchar(50) NOT NULL DEFAULT 'Asia/Tokyo',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  branch_key varchar(100) NOT NULL, name varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, branch_key), UNIQUE(organization_id, id)
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_provider varchar(30) NOT NULL DEFAULT 'google',
  provider_subject_hash char(64) NOT NULL UNIQUE, email_hash char(64) NOT NULL,
  email_masked varchar(320) NOT NULL, display_name varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','closed')),
  last_login_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, branch_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','closed')),
  lock_version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,user_id), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_code varchar(50) NOT NULL UNIQUE,
  description text NOT NULL, capabilities text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL, role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  scope_type varchar(20) NOT NULL DEFAULT 'organization' CHECK(scope_type IN ('self','branch','organization')),
  scope_id uuid NULL, valid_from timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NULL,
  assigned_by_membership_id uuid NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,membership_id,role_id,scope_type,scope_id)
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL, token_hash char(64) NOT NULL UNIQUE, csrf_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL, revoked_at timestamptz NULL,
  FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id) ON DELETE RESTRICT
);
INSERT INTO roles(role_code,description,capabilities) VALUES
 ('assessor','査定員',ARRAY['visit:self','content:read']),
 ('manager','管理者',ARRAY['visit:scope','content:read','content:write','user:manage','job:manage','retention:manage','analytics:read']),
 ('educator','教育担当',ARRAY['content:read','content:write']),
 ('content_approver','コンテンツ承認者',ARRAY['content:read','content:approve']),
 ('system_admin','システム管理者',ARRAY['user:manage','job:manage','audit:read'])
ON CONFLICT(role_code) DO UPDATE SET capabilities=EXCLUDED.capabilities;
