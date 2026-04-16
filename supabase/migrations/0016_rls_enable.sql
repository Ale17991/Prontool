-- T028: Turn on RLS for every tenant-scoped table.
-- tuss_codes and tuss_catalog_versions are global read-only: RLS stays OFF
-- but default grants restrict writes to service-role.

ALTER TABLE public.tenants                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tenants                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_ghl_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedures                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_plans                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_commission_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_versions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_reversals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_webhook_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_event_transitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_status_transitions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log                    ENABLE ROW LEVEL SECURITY;
