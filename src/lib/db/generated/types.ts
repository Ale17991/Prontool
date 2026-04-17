export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      alert_status_transitions: {
        Row: {
          actor: string | null
          alert_id: string
          from_status: string | null
          id: string
          reason: string | null
          tenant_id: string
          to_status: string
          transitioned_at: string
        }
        Insert: {
          actor?: string | null
          alert_id: string
          from_status?: string | null
          id?: string
          reason?: string | null
          tenant_id: string
          to_status: string
          transitioned_at?: string
        }
        Update: {
          actor?: string | null
          alert_id?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          tenant_id?: string
          to_status?: string
          transitioned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_status_transitions_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_status_transitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          created_at: string
          detail: Json
          email_last_sent_at: string | null
          email_sent_to: string[]
          id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject_ref: Json | null
          tenant_id: string
          type: string
        }
        Insert: {
          created_at?: string
          detail: Json
          email_last_sent_at?: string | null
          email_sent_to?: string[]
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_ref?: Json | null
          tenant_id: string
          type: string
        }
        Update: {
          created_at?: string
          detail?: Json
          email_last_sent_at?: string | null
          email_sent_to?: string[]
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject_ref?: Json | null
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reversals: {
        Row: {
          appointment_id: string
          created_at: string
          created_by: string
          id: string
          reason: string
          reversal_amount_cents: number
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          created_by: string
          id?: string
          reason: string
          reversal_amount_cents: number
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
          reversal_amount_cents?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reversals_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reversals_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reversals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_at: string
          created_at: string
          doctor_id: string
          frozen_amount_cents: number
          frozen_commission_bps: number
          id: string
          patient_id: string
          plan_id: string
          procedure_id: string
          source: string
          source_commission_history_id: string
          source_price_version_id: string
          source_raw_event_id: string | null
          tenant_id: string
        }
        Insert: {
          appointment_at: string
          created_at?: string
          doctor_id: string
          frozen_amount_cents: number
          frozen_commission_bps: number
          id?: string
          patient_id: string
          plan_id: string
          procedure_id: string
          source?: string
          source_commission_history_id: string
          source_price_version_id: string
          source_raw_event_id?: string | null
          tenant_id: string
        }
        Update: {
          appointment_at?: string
          created_at?: string
          doctor_id?: string
          frozen_amount_cents?: number
          frozen_commission_bps?: number
          id?: string
          patient_id?: string
          plan_id?: string
          procedure_id?: string
          source?: string
          source_commission_history_id?: string
          source_price_version_id?: string
          source_raw_event_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "health_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_source_commission_history_id_fkey"
            columns: ["source_commission_history_id"]
            isOneToOne: false
            referencedRelation: "doctor_commission_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_source_price_version_id_fkey"
            columns: ["source_price_version_id"]
            isOneToOne: false
            referencedRelation: "price_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_source_price_version_id_fkey"
            columns: ["source_price_version_id"]
            isOneToOne: false
            referencedRelation: "price_versions_with_vigencia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_source_raw_event_fk"
            columns: ["source_raw_event_id"]
            isOneToOne: false
            referencedRelation: "dlq_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_source_raw_event_fk"
            columns: ["source_raw_event_id"]
            isOneToOne: false
            referencedRelation: "raw_webhook_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          actor_id: string | null
          actor_label: string | null
          entity: string
          entity_id: string | null
          field: string | null
          id: string
          ip: unknown
          new_value: string | null
          old_value: string | null
          reason: string | null
          result: string
          tenant_id: string
          timestamp_utc: string
          user_agent: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_label?: string | null
          entity: string
          entity_id?: string | null
          field?: string | null
          id?: string
          ip?: unknown
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          result?: string
          tenant_id: string
          timestamp_utc?: string
          user_agent?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_label?: string | null
          entity?: string
          entity_id?: string | null
          field?: string | null
          id?: string
          ip?: unknown
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          result?: string
          tenant_id?: string
          timestamp_utc?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_commission_history: {
        Row: {
          created_at: string
          created_by: string | null
          doctor_id: string
          id: string
          percentage_bps: number
          reason: string
          tenant_id: string
          valid_from: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doctor_id: string
          id?: string
          percentage_bps: number
          reason: string
          tenant_id: string
          valid_from: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doctor_id?: string
          id?: string
          percentage_bps?: number
          reason?: string
          tenant_id?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_commission_history_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_commission_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          crm: string
          external_identifier: string | null
          full_name: string
          id: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          crm: string
          external_identifier?: string | null
          full_name: string
          id?: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          crm?: string
          external_identifier?: string | null
          full_name?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      health_plans: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          anonymized_at: string | null
          birth_date_enc: string | null
          cpf_enc: string
          created_at: string
          email_enc: string | null
          full_name_enc: string
          ghl_contact_id: string
          id: string
          phone_enc: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          anonymized_at?: string | null
          birth_date_enc?: string | null
          cpf_enc: string
          created_at?: string
          email_enc?: string | null
          full_name_enc: string
          ghl_contact_id: string
          id?: string
          phone_enc?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          anonymized_at?: string | null
          birth_date_enc?: string | null
          cpf_enc?: string
          created_at?: string
          email_enc?: string | null
          full_name_enc?: string
          ghl_contact_id?: string
          id?: string
          phone_enc?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      price_versions: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string
          id: string
          plan_id: string
          previous_version_id: string | null
          procedure_id: string
          reason: string
          tenant_id: string
          valid_from: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by: string
          id?: string
          plan_id: string
          previous_version_id?: string | null
          procedure_id: string
          reason: string
          tenant_id: string
          valid_from: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string
          id?: string
          plan_id?: string
          previous_version_id?: string | null
          procedure_id?: string
          reason?: string
          tenant_id?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "health_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_versions_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "price_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_versions_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "price_versions_with_vigencia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_versions_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      procedures: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          display_name: string | null
          id: string
          tenant_id: string
          tuss_code: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          id?: string
          tenant_id: string
          tuss_code: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          id?: string
          tenant_id?: string
          tuss_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_webhook_events: {
        Row: {
          ghl_event_id: string
          headers: Json
          id: string
          last_processed_at: string | null
          payload: Json
          processing_attempt_count: number
          processing_status: string
          received_at: string
          tenant_id: string
        }
        Insert: {
          ghl_event_id: string
          headers: Json
          id?: string
          last_processed_at?: string | null
          payload: Json
          processing_attempt_count?: number
          processing_status?: string
          received_at?: string
          tenant_id: string
        }
        Update: {
          ghl_event_id?: string
          headers?: Json
          id?: string
          last_processed_at?: string | null
          payload?: Json
          processing_attempt_count?: number
          processing_status?: string
          received_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_ghl_config: {
        Row: {
          field_map_appointment_timestamp: string | null
          field_map_medico_identifier: string
          field_map_patient_birth_date: string
          field_map_patient_cpf: string
          field_map_patient_email: string
          field_map_patient_name: string
          field_map_patient_phone: string
          field_map_plano: string
          field_map_procedimento_tuss: string
          tenant_id: string
          trigger_stage_name: string
          updated_at: string
          webhook_secret_enc: string
        }
        Insert: {
          field_map_appointment_timestamp?: string | null
          field_map_medico_identifier: string
          field_map_patient_birth_date: string
          field_map_patient_cpf: string
          field_map_patient_email: string
          field_map_patient_name: string
          field_map_patient_phone: string
          field_map_plano: string
          field_map_procedimento_tuss: string
          tenant_id: string
          trigger_stage_name: string
          updated_at?: string
          webhook_secret_enc: string
        }
        Update: {
          field_map_appointment_timestamp?: string | null
          field_map_medico_identifier?: string
          field_map_patient_birth_date?: string
          field_map_patient_cpf?: string
          field_map_patient_email?: string
          field_map_patient_name?: string
          field_map_patient_phone?: string
          field_map_plano?: string
          field_map_procedimento_tuss?: string
          tenant_id?: string
          trigger_stage_name?: string
          updated_at?: string
          webhook_secret_enc?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_ghl_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      tuss_catalog_versions: {
        Row: {
          code_count: number
          content_hash: string
          id: string
          imported_at: string
          imported_by: string | null
          notes: string | null
          source_ref: string
        }
        Insert: {
          code_count: number
          content_hash: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          notes?: string | null
          source_ref: string
        }
        Update: {
          code_count?: number
          content_hash?: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          notes?: string | null
          source_ref?: string
        }
        Relationships: []
      }
      tuss_codes: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          source_catalog_version_id: string
          terminology_chapter: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          id?: string
          source_catalog_version_id: string
          terminology_chapter?: string | null
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          source_catalog_version_id?: string
          terminology_chapter?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tuss_codes_source_catalog_version_id_fkey"
            columns: ["source_catalog_version_id"]
            isOneToOne: false
            referencedRelation: "tuss_catalog_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_tenants: {
        Row: {
          created_at: string
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tenants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_event_transitions: {
        Row: {
          actor: string | null
          from_status: string | null
          id: string
          raw_event_id: string
          reason: string | null
          tenant_id: string
          to_status: string
          transitioned_at: string
        }
        Insert: {
          actor?: string | null
          from_status?: string | null
          id?: string
          raw_event_id: string
          reason?: string | null
          tenant_id: string
          to_status: string
          transitioned_at?: string
        }
        Update: {
          actor?: string | null
          from_status?: string | null
          id?: string
          raw_event_id?: string
          reason?: string | null
          tenant_id?: string
          to_status?: string
          transitioned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_event_transitions_raw_event_id_fkey"
            columns: ["raw_event_id"]
            isOneToOne: false
            referencedRelation: "dlq_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_event_transitions_raw_event_id_fkey"
            columns: ["raw_event_id"]
            isOneToOne: false
            referencedRelation: "raw_webhook_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_event_transitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      appointments_effective: {
        Row: {
          appointment_at: string | null
          created_at: string | null
          doctor_id: string | null
          effective_status: string | null
          frozen_amount_cents: number | null
          frozen_commission_bps: number | null
          id: string | null
          net_amount_cents: number | null
          net_commission_cents: number | null
          patient_id: string | null
          plan_id: string | null
          procedure_id: string | null
          reversal_id: string | null
          reversed_at: string | null
          source: string | null
          source_commission_history_id: string | null
          source_price_version_id: string | null
          source_raw_event_id: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "health_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_source_commission_history_id_fkey"
            columns: ["source_commission_history_id"]
            isOneToOne: false
            referencedRelation: "doctor_commission_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_source_price_version_id_fkey"
            columns: ["source_price_version_id"]
            isOneToOne: false
            referencedRelation: "price_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_source_price_version_id_fkey"
            columns: ["source_price_version_id"]
            isOneToOne: false
            referencedRelation: "price_versions_with_vigencia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_source_raw_event_fk"
            columns: ["source_raw_event_id"]
            isOneToOne: false
            referencedRelation: "dlq_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_source_raw_event_fk"
            columns: ["source_raw_event_id"]
            isOneToOne: false
            referencedRelation: "raw_webhook_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dlq_events: {
        Row: {
          failure_reason: string | null
          ghl_event_id: string | null
          headers: Json | null
          id: string | null
          last_processed_at: string | null
          payload: Json | null
          processing_attempt_count: number | null
          processing_status: string | null
          received_at: string | null
          tenant_id: string | null
        }
        Insert: {
          failure_reason?: never
          ghl_event_id?: string | null
          headers?: Json | null
          id?: string | null
          last_processed_at?: string | null
          payload?: Json | null
          processing_attempt_count?: number | null
          processing_status?: string | null
          received_at?: string | null
          tenant_id?: string | null
        }
        Update: {
          failure_reason?: never
          ghl_event_id?: string | null
          headers?: Json | null
          id?: string | null
          last_processed_at?: string | null
          payload?: Json | null
          processing_attempt_count?: number | null
          processing_status?: string | null
          received_at?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_commission_current: {
        Row: {
          created_at: string | null
          doctor_id: string | null
          percentage_bps: number | null
          tenant_id: string | null
          valid_from: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_commission_history_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_commission_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      price_versions_with_vigencia: {
        Row: {
          amount_cents: number | null
          created_at: string | null
          created_by: string | null
          id: string | null
          plan_id: string | null
          previous_version_id: string | null
          procedure_id: string | null
          reason: string | null
          tenant_id: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "health_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_versions_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "price_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_versions_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "price_versions_with_vigencia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_versions_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      auth_hook_custom_claims: { Args: { event: Json }; Returns: Json }
      dec_text: { Args: { cipher: string }; Returns: string }
      enc_text: { Args: { plain: string }; Returns: string }
      jwt_role: { Args: never; Returns: string }
      jwt_tenant_id: { Args: never; Returns: string }
      log_audit_event: {
        Args: {
          p_entity: string
          p_entity_id: string
          p_field: string
          p_new: string
          p_old: string
          p_reason: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      patient_enc_key: { Args: never; Returns: string }
      session_text: { Args: { key: string }; Returns: string }
      session_uuid: { Args: { key: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

