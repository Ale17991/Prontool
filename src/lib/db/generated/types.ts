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
      anamnesis_templates: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          description: string | null
          fields: Json
          id: string
          previous_version_id: string | null
          tenant_id: string
          title: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          description?: string | null
          fields: Json
          id?: string
          previous_version_id?: string | null
          tenant_id: string
          title: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          description?: string | null
          fields?: Json
          id?: string
          previous_version_id?: string | null
          tenant_id?: string
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "anamnesis_templates_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "anamnesis_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anamnesis_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_assistants: {
        Row: {
          appointment_id: string
          assistant_doctor_id: string
          created_at: string
          created_by: string
          frozen_amount_cents: number
          id: string
          removed_at: string | null
          removed_by: string | null
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          assistant_doctor_id: string
          created_at?: string
          created_by: string
          frozen_amount_cents: number
          id?: string
          removed_at?: string | null
          removed_by?: string | null
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          assistant_doctor_id?: string
          created_at?: string
          created_by?: string
          frozen_amount_cents?: number
          id?: string
          removed_at?: string | null
          removed_by?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_assistants_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_assistants_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_assistants_assistant_doctor_id_fkey"
            columns: ["assistant_doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_assistants_assistant_doctor_id_fkey"
            columns: ["assistant_doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
          },
          {
            foreignKeyName: "appointment_assistants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_cancellations: {
        Row: {
          appointment_id: string
          cancelled_at: string
          cancelled_by: string
          id: string
          notes: string | null
          reason: string
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          cancelled_at?: string
          cancelled_by: string
          id?: string
          notes?: string | null
          reason: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          cancelled_at?: string
          cancelled_by?: string
          id?: string
          notes?: string | null
          reason?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_cancellations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_cancellations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_cancellations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_completions: {
        Row: {
          appointment_id: string
          completed_at: string
          completed_by: string
          id: string
          reason: string | null
          source: string
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          completed_at?: string
          completed_by: string
          id?: string
          reason?: string | null
          source: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          completed_at?: string
          completed_by?: string
          id?: string
          reason?: string | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_completions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_completions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_completions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_confirmations: {
        Row: {
          appointment_id: string
          confirmed_at: string
          confirmed_by: string
          id: string
          notes: string | null
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          confirmed_at?: string
          confirmed_by: string
          id?: string
          notes?: string | null
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          confirmed_at?: string
          confirmed_by?: string
          id?: string
          notes?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_confirmations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_confirmations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_confirmations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_materials: {
        Row: {
          appointment_id: string
          created_at: string
          created_by: string
          id: string
          quantity: number
          tenant_id: string
          tuss_code: string
          tuss_description: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          created_by: string
          id?: string
          quantity?: number
          tenant_id: string
          tuss_code: string
          tuss_description: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          created_by?: string
          id?: string
          quantity?: number
          tenant_id?: string
          tuss_code?: string
          tuss_description?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_materials_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_materials_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_materials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_materials_tuss_code_fkey"
            columns: ["tuss_code"]
            isOneToOne: false
            referencedRelation: "tuss_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      appointment_procedures: {
        Row: {
          amount_was_overridden: boolean
          appointment_id: string
          created_at: string
          created_by: string
          id: string
          line_amount_cents: number
          notes: string | null
          plan_id: string | null
          procedure_id: string
          quantity: number
          sequence: number
          source_price_version_id: string | null
          tenant_id: string
          vigente_amount_cents: number
        }
        Insert: {
          amount_was_overridden?: boolean
          appointment_id: string
          created_at?: string
          created_by: string
          id?: string
          line_amount_cents: number
          notes?: string | null
          plan_id?: string | null
          procedure_id: string
          quantity?: number
          sequence: number
          source_price_version_id?: string | null
          tenant_id: string
          vigente_amount_cents: number
        }
        Update: {
          amount_was_overridden?: boolean
          appointment_id?: string
          created_at?: string
          created_by?: string
          id?: string
          line_amount_cents?: number
          notes?: string | null
          plan_id?: string | null
          procedure_id?: string
          quantity?: number
          sequence?: number
          source_price_version_id?: string | null
          tenant_id?: string
          vigente_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_procedures_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_procedures_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_procedures_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "health_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_procedures_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_procedures_source_price_version_id_fkey"
            columns: ["source_price_version_id"]
            isOneToOne: false
            referencedRelation: "price_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_procedures_source_price_version_id_fkey"
            columns: ["source_price_version_id"]
            isOneToOne: false
            referencedRelation: "price_versions_with_vigencia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_procedures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reminders: {
        Row: {
          appointment_id: string
          channel: string
          created_at: string
          error: string | null
          id: string
          is_manual: boolean
          provider_message_id: string | null
          scheduled_offset_hours: number
          sent_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          is_manual?: boolean
          provider_message_id?: string | null
          scheduled_offset_hours: number
          sent_at?: string | null
          status: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          is_manual?: boolean
          provider_message_id?: string | null
          scheduled_offset_hours?: number
          sent_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reminders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reminders_tenant_id_fkey"
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
      appointment_slot_locks: {
        Row: {
          appointment_id: string
          doctor_id: string
          id: string
          slot_range: unknown
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          doctor_id: string
          id?: string
          slot_range: unknown
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          doctor_id?: string
          id?: string
          slot_range?: unknown
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_slot_locks_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_slot_locks_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_slot_locks_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_slot_locks_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
          },
          {
            foreignKeyName: "appointment_slot_locks_tenant_id_fkey"
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
          duration_minutes: number | null
          frozen_amount_cents: number
          frozen_commission_bps: number
          id: string
          observacoes: string | null
          patient_id: string
          plan_id: string | null
          procedure_id: string
          source: string
          source_commission_history_id: string
          source_price_version_id: string | null
          source_raw_event_id: string | null
          tenant_id: string
        }
        Insert: {
          appointment_at: string
          created_at?: string
          doctor_id: string
          duration_minutes?: number | null
          frozen_amount_cents: number
          frozen_commission_bps: number
          id?: string
          observacoes?: string | null
          patient_id: string
          plan_id?: string | null
          procedure_id: string
          source?: string
          source_commission_history_id: string
          source_price_version_id?: string | null
          source_raw_event_id?: string | null
          tenant_id: string
        }
        Update: {
          appointment_at?: string
          created_at?: string
          doctor_id?: string
          duration_minutes?: number | null
          frozen_amount_cents?: number
          frozen_commission_bps?: number
          id?: string
          observacoes?: string | null
          patient_id?: string
          plan_id?: string | null
          procedure_id?: string
          source?: string
          source_commission_history_id?: string
          source_price_version_id?: string | null
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
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
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
      cid10_codes: {
        Row: {
          chapter: string | null
          code: string
          created_at: string
          description: string
          id: string
        }
        Insert: {
          chapter?: string | null
          code: string
          created_at?: string
          description: string
          id?: string
        }
        Update: {
          chapter?: string | null
          code?: string
          created_at?: string
          description?: string
          id?: string
        }
        Relationships: []
      }
      clinical_records: {
        Row: {
          anamnesis_data: Json | null
          assessment_cids: Json | null
          content: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          file_name: string | null
          file_size_bytes: number | null
          file_url: string | null
          id: string
          patient_id: string
          soap_data: Json | null
          tenant_id: string
          title: string
          type: string
        }
        Insert: {
          anamnesis_data?: Json | null
          assessment_cids?: Json | null
          content?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          id?: string
          patient_id: string
          soap_data?: Json | null
          tenant_id: string
          title: string
          type: string
        }
        Update: {
          anamnesis_data?: Json | null
          assessment_cids?: Json | null
          content?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          id?: string
          patient_id?: string
          soap_data?: Json | null
          tenant_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_procedure_codes: {
        Row: {
          category: string | null
          code: string
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string
          id: string
          tenant_id: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description: string
          id?: string
          tenant_id: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_procedure_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_procedure_tables: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_procedure_tables_tenant_id_fkey"
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
            foreignKeyName: "doctor_commission_history_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
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
      doctor_payment_terms_history: {
        Row: {
          billing_day: number | null
          created_at: string
          created_by: string
          doctor_id: string
          id: string
          liberal_default_cents: number | null
          monthly_amount_cents: number | null
          payment_mode: Database["public"]["Enums"]["payment_mode"]
          percentage_bps: number | null
          reason: string
          tenant_id: string
          valid_from: string
        }
        Insert: {
          billing_day?: number | null
          created_at?: string
          created_by: string
          doctor_id: string
          id?: string
          liberal_default_cents?: number | null
          monthly_amount_cents?: number | null
          payment_mode: Database["public"]["Enums"]["payment_mode"]
          percentage_bps?: number | null
          reason: string
          tenant_id: string
          valid_from: string
        }
        Update: {
          billing_day?: number | null
          created_at?: string
          created_by?: string
          doctor_id?: string
          id?: string
          liberal_default_cents?: number | null
          monthly_amount_cents?: number | null
          payment_mode?: Database["public"]["Enums"]["payment_mode"]
          percentage_bps?: number | null
          reason?: string
          tenant_id?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_payment_terms_history_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_payment_terms_history_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
          },
          {
            foreignKeyName: "doctor_payment_terms_history_tenant_id_fkey"
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
          birth_date: string | null
          council_name: string | null
          council_number: string | null
          council_state: string | null
          cpf: string | null
          created_at: string
          created_by: string | null
          crm: string
          external_identifier: string | null
          full_name: string
          id: string
          payment_mode: Database["public"]["Enums"]["payment_mode"]
          role: string
          specialty: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          birth_date?: string | null
          council_name?: string | null
          council_number?: string | null
          council_state?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          crm: string
          external_identifier?: string | null
          full_name: string
          id?: string
          payment_mode?: Database["public"]["Enums"]["payment_mode"]
          role?: string
          specialty?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          birth_date?: string | null
          council_name?: string | null
          council_number?: string | null
          council_state?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          crm?: string
          external_identifier?: string | null
          full_name?: string
          id?: string
          payment_mode?: Database["public"]["Enums"]["payment_mode"]
          role?: string
          specialty?: string | null
          tenant_id?: string
          user_id?: string | null
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
      expense_receipts: {
        Row: {
          content_type: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          expense_id: string
          file_name: string
          file_size_bytes: number
          id: string
          storage_path: string
          tenant_id: string
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          content_type: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          expense_id: string
          file_name: string
          file_size_bytes: number
          id?: string
          storage_path: string
          tenant_id: string
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          content_type?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          expense_id?: string
          file_name?: string
          file_size_bytes?: number
          id?: string
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_receipts_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_cents: number
          category: string
          competence_date: string
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string
          frequency: string | null
          id: string
          paid_amount_cents: number | null
          paid_at: string | null
          payment_method: string | null
          receipt_file_name: string | null
          receipt_file_size: number | null
          receipt_file_url: string | null
          recurring: boolean
          recurring_ends_at: string | null
          recurring_starts_at: string | null
          superseded_by: string | null
          supplier: string | null
          tax_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          category: string
          competence_date: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description: string
          frequency?: string | null
          id?: string
          paid_amount_cents?: number | null
          paid_at?: string | null
          payment_method?: string | null
          receipt_file_name?: string | null
          receipt_file_size?: number | null
          receipt_file_url?: string | null
          recurring?: boolean
          recurring_ends_at?: string | null
          recurring_starts_at?: string | null
          superseded_by?: string | null
          supplier?: string | null
          tax_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          category?: string
          competence_date?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          frequency?: string | null
          id?: string
          paid_amount_cents?: number | null
          paid_at?: string | null
          payment_method?: string | null
          receipt_file_name?: string | null
          receipt_file_size?: number | null
          receipt_file_url?: string | null
          recurring?: boolean
          recurring_ends_at?: string | null
          recurring_starts_at?: string | null
          superseded_by?: string | null
          supplier?: string | null
          tax_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tenant_id_fkey"
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
          tax_rate_bps: number
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          tax_rate_bps?: number
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          tax_rate_bps?: number
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
      installment_payments: {
        Row: {
          actor_user_id: string
          amount_cents: number
          created_at: string
          id: string
          installment_id: string
          note: string | null
          paid_at: string
          payment_method: string
          tenant_id: string
        }
        Insert: {
          actor_user_id: string
          amount_cents: number
          created_at?: string
          id?: string
          installment_id: string
          note?: string | null
          paid_at: string
          payment_method: string
          tenant_id: string
        }
        Update: {
          actor_user_id?: string
          amount_cents?: number
          created_at?: string
          id?: string
          installment_id?: string
          note?: string | null
          paid_at?: string
          payment_method?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_payments_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "payment_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_log: {
        Row: {
          detail: Json | null
          error_code: string | null
          error_message: string | null
          id: string
          kind: string
          occurred_at: string
          provider: string
          status: string
          tenant_id: string
        }
        Insert: {
          detail?: Json | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          kind: string
          occurred_at?: string
          provider: string
          status: string
          tenant_id: string
        }
        Update: {
          detail?: Json | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          kind?: string
          occurred_at?: string
          provider?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_payouts: {
        Row: {
          adjustments_cents: number
          closed_at: string | null
          closed_by: string | null
          commission_cents: number
          created_at: string
          doctor_id: string
          fixed_payment_cents: number
          gross_revenue_cents: number
          id: string
          liberal_payment_cents: number
          month: string
          paid_amount_cents: number | null
          paid_at: string | null
          payment_method: string | null
          payment_note: string | null
          tenant_id: string
          total_due_cents: number
          updated_at: string
        }
        Insert: {
          adjustments_cents?: number
          closed_at?: string | null
          closed_by?: string | null
          commission_cents?: number
          created_at?: string
          doctor_id: string
          fixed_payment_cents?: number
          gross_revenue_cents?: number
          id?: string
          liberal_payment_cents?: number
          month: string
          paid_amount_cents?: number | null
          paid_at?: string | null
          payment_method?: string | null
          payment_note?: string | null
          tenant_id: string
          total_due_cents?: number
          updated_at?: string
        }
        Update: {
          adjustments_cents?: number
          closed_at?: string | null
          closed_by?: string | null
          commission_cents?: number
          created_at?: string
          doctor_id?: string
          fixed_payment_cents?: number
          gross_revenue_cents?: number
          id?: string
          liberal_payment_cents?: number
          month?: string
          paid_amount_cents?: number | null
          paid_at?: string | null
          payment_method?: string | null
          payment_note?: string | null
          tenant_id?: string
          total_due_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_payouts_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_payouts_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
          },
          {
            foreignKeyName: "monthly_payouts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_payouts_adjustments: {
        Row: {
          applied_month: string
          created_at: string
          delta_cents: number
          doctor_id: string
          id: string
          original_appointment_id: string
          original_month: string
          reason: string
          tenant_id: string
        }
        Insert: {
          applied_month: string
          created_at?: string
          delta_cents: number
          doctor_id: string
          id?: string
          original_appointment_id: string
          original_month: string
          reason: string
          tenant_id: string
        }
        Update: {
          applied_month?: string
          created_at?: string
          delta_cents?: number
          doctor_id?: string
          id?: string
          original_appointment_id?: string
          original_month?: string
          reason?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_payouts_adjustments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_payouts_adjustments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
          },
          {
            foreignKeyName: "monthly_payouts_adjustments_original_appointment_id_fkey"
            columns: ["original_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_payouts_adjustments_original_appointment_id_fkey"
            columns: ["original_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_payouts_adjustments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_payouts_reopens: {
        Row: {
          created_at: string
          id: string
          month: string
          reason: string
          reopened_at: string
          reopened_by: string
          snapshot_before: Json
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          reason: string
          reopened_at?: string
          reopened_by: string
          snapshot_before: Json
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          reason?: string
          reopened_at?: string
          reopened_by?: string
          snapshot_before?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_payouts_reopens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          is_read: boolean
          read_at: string | null
          reference_id: string | null
          reference_key: string
          reference_type: string | null
          tenant_id: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_read?: boolean
          read_at?: string | null
          reference_id?: string | null
          reference_key: string
          reference_type?: string | null
          tenant_id: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_read?: boolean
          read_at?: string | null
          reference_id?: string | null
          reference_key?: string
          reference_type?: string | null
          tenant_id?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_allergies: {
        Row: {
          deleted_at: string | null
          id: string
          notes: string | null
          patient_id: string
          reported_at: string
          reported_by: string
          severity: string
          substance: string
          tenant_id: string
        }
        Insert: {
          deleted_at?: string | null
          id?: string
          notes?: string | null
          patient_id: string
          reported_at?: string
          reported_by: string
          severity?: string
          substance: string
          tenant_id: string
        }
        Update: {
          deleted_at?: string | null
          id?: string
          notes?: string | null
          patient_id?: string
          reported_at?: string
          reported_by?: string
          severity?: string
          substance?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_allergies_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_allergies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_diagnoses: {
        Row: {
          additional_notes: string | null
          cid10_code: string
          cid10_description: string
          created_at: string
          deleted_at: string | null
          diagnosed_at: string
          diagnosed_by: string
          id: string
          patient_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          additional_notes?: string | null
          cid10_code: string
          cid10_description: string
          created_at?: string
          deleted_at?: string | null
          diagnosed_at?: string
          diagnosed_by: string
          id?: string
          patient_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          additional_notes?: string | null
          cid10_code?: string
          cid10_description?: string
          created_at?: string
          deleted_at?: string | null
          diagnosed_at?: string
          diagnosed_by?: string
          id?: string
          patient_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_diagnoses_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_diagnoses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_history: {
        Row: {
          category: string
          created_at: string
          date_reported: string | null
          deleted_at: string | null
          description: string
          id: string
          notes: string | null
          patient_id: string
          reported_by: string
          tenant_id: string
        }
        Insert: {
          category: string
          created_at?: string
          date_reported?: string | null
          deleted_at?: string | null
          description: string
          id?: string
          notes?: string | null
          patient_id: string
          reported_by: string
          tenant_id: string
        }
        Update: {
          category?: string
          created_at?: string
          date_reported?: string | null
          deleted_at?: string | null
          description?: string
          id?: string
          notes?: string | null
          patient_id?: string
          reported_by?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_history_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_tag_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          patient_id: string
          tag_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          patient_id: string
          tag_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          patient_id?: string
          tag_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_tag_assignments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "patient_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_tag_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          address_cep_enc: string | null
          address_city_enc: string | null
          address_complement_enc: string | null
          address_neighborhood_enc: string | null
          address_number_enc: string | null
          address_state_enc: string | null
          address_street_enc: string | null
          anonymized_at: string | null
          birth_date_enc: string | null
          cpf_enc: string | null
          created_at: string
          email_enc: string | null
          emergency_contact_name_enc: string | null
          emergency_contact_phone_enc: string | null
          full_name_enc: string
          ghl_contact_id: string | null
          guardian_cpf_enc: string | null
          guardian_name_enc: string | null
          guardian_relationship_enc: string | null
          id: string
          insurance_card_number_enc: string | null
          mother_name_enc: string | null
          phone_enc: string | null
          plan_id: string | null
          reminders_opt_in: boolean
          rg_enc: string | null
          sex: string | null
          social_name_enc: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address_cep_enc?: string | null
          address_city_enc?: string | null
          address_complement_enc?: string | null
          address_neighborhood_enc?: string | null
          address_number_enc?: string | null
          address_state_enc?: string | null
          address_street_enc?: string | null
          anonymized_at?: string | null
          birth_date_enc?: string | null
          cpf_enc?: string | null
          created_at?: string
          email_enc?: string | null
          emergency_contact_name_enc?: string | null
          emergency_contact_phone_enc?: string | null
          full_name_enc: string
          ghl_contact_id?: string | null
          guardian_cpf_enc?: string | null
          guardian_name_enc?: string | null
          guardian_relationship_enc?: string | null
          id?: string
          insurance_card_number_enc?: string | null
          mother_name_enc?: string | null
          phone_enc?: string | null
          plan_id?: string | null
          reminders_opt_in?: boolean
          rg_enc?: string | null
          sex?: string | null
          social_name_enc?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address_cep_enc?: string | null
          address_city_enc?: string | null
          address_complement_enc?: string | null
          address_neighborhood_enc?: string | null
          address_number_enc?: string | null
          address_state_enc?: string | null
          address_street_enc?: string | null
          anonymized_at?: string | null
          birth_date_enc?: string | null
          cpf_enc?: string | null
          created_at?: string
          email_enc?: string | null
          emergency_contact_name_enc?: string | null
          emergency_contact_phone_enc?: string | null
          full_name_enc?: string
          ghl_contact_id?: string | null
          guardian_cpf_enc?: string | null
          guardian_name_enc?: string | null
          guardian_relationship_enc?: string | null
          id?: string
          insurance_card_number_enc?: string | null
          mother_name_enc?: string | null
          phone_enc?: string | null
          plan_id?: string | null
          reminders_opt_in?: boolean
          rg_enc?: string | null
          sex?: string | null
          social_name_enc?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "health_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_installments: {
        Row: {
          amount_cents: number
          created_at: string
          due_date: string
          id: string
          installment_number: number
          paid_amount_cents: number
          paid_at: string | null
          payment_method: string | null
          payment_record_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          paid_amount_cents?: number
          paid_at?: string | null
          payment_method?: string | null
          payment_record_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          paid_amount_cents?: number
          paid_at?: string | null
          payment_method?: string | null
          payment_record_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_installments_payment_record_id_fkey"
            columns: ["payment_record_id"]
            isOneToOne: false
            referencedRelation: "payment_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_installments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_records: {
        Row: {
          appointment_id: string | null
          created_at: string
          created_by: string
          id: string
          installments: number
          notes: string | null
          paid_amount_cents: number
          paid_at: string | null
          patient_id: string
          payment_method: string
          payment_status: string
          tenant_id: string
          total_amount_cents: number
          treatment_step_id: string | null
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          installments?: number
          notes?: string | null
          paid_amount_cents?: number
          paid_at?: string | null
          patient_id: string
          payment_method: string
          payment_status?: string
          tenant_id: string
          total_amount_cents: number
          treatment_step_id?: string | null
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          installments?: number
          notes?: string | null
          paid_amount_cents?: number
          paid_at?: string | null
          patient_id?: string
          payment_method?: string
          payment_status?: string
          tenant_id?: string
          total_amount_cents?: number
          treatment_step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_treatment_step_id_fkey"
            columns: ["treatment_step_id"]
            isOneToOne: false
            referencedRelation: "treatment_plan_steps"
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
          covered_by_plan: boolean
          created_at: string
          created_by: string | null
          custom_code_id: string | null
          custom_table_id: string | null
          default_amount_cents: number | null
          deleted_at: string | null
          deleted_by: string | null
          display_name: string | null
          id: string
          is_unlisted: boolean
          tenant_id: string
          tuss_code: string | null
        }
        Insert: {
          active?: boolean
          covered_by_plan?: boolean
          created_at?: string
          created_by?: string | null
          custom_code_id?: string | null
          custom_table_id?: string | null
          default_amount_cents?: number | null
          deleted_at?: string | null
          deleted_by?: string | null
          display_name?: string | null
          id?: string
          is_unlisted?: boolean
          tenant_id: string
          tuss_code?: string | null
        }
        Update: {
          active?: boolean
          covered_by_plan?: boolean
          created_at?: string
          created_by?: string | null
          custom_code_id?: string | null
          custom_table_id?: string | null
          default_amount_cents?: number | null
          deleted_at?: string | null
          deleted_by?: string | null
          display_name?: string | null
          id?: string
          is_unlisted?: boolean
          tenant_id?: string
          tuss_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procedures_custom_code_id_fkey"
            columns: ["custom_code_id"]
            isOneToOne: false
            referencedRelation: "custom_procedure_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedures_custom_table_id_fkey"
            columns: ["custom_table_id"]
            isOneToOne: false
            referencedRelation: "custom_procedure_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedures_tuss_code_fkey"
            columns: ["tuss_code"]
            isOneToOne: false
            referencedRelation: "tuss_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      public_booking_doctor_procedures: {
        Row: {
          created_at: string
          display_name: string
          display_order: number
          doctor_id: string
          duration_minutes: number
          procedure_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          display_order?: number
          doctor_id: string
          duration_minutes: number
          procedure_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          display_order?: number
          doctor_id?: string
          duration_minutes?: number
          procedure_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_booking_doctor_procedures_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_booking_doctor_procedures_tenant_id_doctor_id_fkey"
            columns: ["tenant_id", "doctor_id"]
            isOneToOne: false
            referencedRelation: "public_booking_doctors"
            referencedColumns: ["tenant_id", "doctor_id"]
          },
        ]
      }
      public_booking_doctors: {
        Row: {
          available_from: string
          available_until: string
          available_weekdays: number[]
          bio: string | null
          created_at: string
          display_order: number
          doctor_id: string
          lunch_break_from: string | null
          lunch_break_until: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          available_from?: string
          available_until?: string
          available_weekdays?: number[]
          bio?: string | null
          created_at?: string
          display_order?: number
          doctor_id: string
          lunch_break_from?: string | null
          lunch_break_until?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          available_from?: string
          available_until?: string
          available_weekdays?: number[]
          bio?: string | null
          created_at?: string
          display_order?: number
          doctor_id?: string
          lunch_break_from?: string | null
          lunch_break_until?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_booking_doctors_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_booking_doctors_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
          },
          {
            foreignKeyName: "public_booking_doctors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      public_booking_rate_limits: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_hash: string
          tenant_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_hash: string
          tenant_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_hash?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_booking_rate_limits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      public_booking_tokens: {
        Row: {
          action: string
          appointment_id: string
          created_at: string
          expires_at: string
          id: string
          tenant_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          action: string
          appointment_id: string
          created_at?: string
          expires_at?: string
          id?: string
          tenant_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          action?: string
          appointment_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          tenant_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "public_booking_tokens_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_booking_tokens_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_booking_tokens_tenant_id_fkey"
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
      schedule_blocks: {
        Row: {
          all_day: boolean
          block_date: string
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          doctor_id: string
          end_time: string | null
          id: string
          reason: string
          start_time: string | null
          tenant_id: string
        }
        Insert: {
          all_day?: boolean
          block_date: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          doctor_id: string
          end_time?: string | null
          id?: string
          reason: string
          start_time?: string | null
          tenant_id: string
        }
        Update: {
          all_day?: boolean
          block_date?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          doctor_id?: string
          end_time?: string | null
          id?: string
          reason?: string
          start_time?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_blocks_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_blocks_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
          },
          {
            foreignKeyName: "schedule_blocks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_by: string
          assigned_to: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          due_date: string
          id: string
          notes: string | null
          priority: string
          status: string
          tenant_id: string
          title: string
        }
        Insert: {
          assigned_by: string
          assigned_to: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          due_date: string
          id?: string
          notes?: string | null
          priority: string
          status?: string
          tenant_id: string
          title: string
        }
        Update: {
          assigned_by?: string
          assigned_to?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          due_date?: string
          id?: string
          notes?: string | null
          priority?: string
          status?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      taxes: {
        Row: {
          category: string
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          rate_bps: number
          tenant_id: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          rate_bps: number
          tenant_id: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          rate_bps?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "taxes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_cash_balance_adjustments: {
        Row: {
          actor_user_id: string
          amount_cents: number
          created_at: string
          effective_from: string
          id: string
          reason: string
          tenant_id: string
        }
        Insert: {
          actor_user_id: string
          amount_cents: number
          created_at?: string
          effective_from: string
          id?: string
          reason: string
          tenant_id: string
        }
        Update: {
          actor_user_id?: string
          amount_cents?: number
          created_at?: string
          effective_from?: string
          id?: string
          reason?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_cash_balance_adjustments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_clinic_profile: {
        Row: {
          address_cep: string | null
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_street: string | null
          address_uf: string | null
          cnpj: string | null
          corporate_name: string | null
          created_at: string
          email: string | null
          logo_path: string | null
          logo_uploaded_at: string | null
          phone: string | null
          public_booking_cancel_min_hours: number
          public_booking_enabled: boolean
          public_booking_max_days_advance: number
          public_booking_min_hours_advance: number
          public_booking_slug: string | null
          reminder_enabled: boolean
          reminder_last_run_at: string | null
          reminder_offsets_hours: number[]
          reminder_send_weekends: boolean
          reminder_template_body: string | null
          reminder_template_subject: string | null
          reminder_window_end: string
          reminder_window_start: string
          tech_responsible_council: string | null
          tech_responsible_name: string | null
          tech_responsible_registration: string | null
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address_cep?: string | null
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_street?: string | null
          address_uf?: string | null
          cnpj?: string | null
          corporate_name?: string | null
          created_at?: string
          email?: string | null
          logo_path?: string | null
          logo_uploaded_at?: string | null
          phone?: string | null
          public_booking_cancel_min_hours?: number
          public_booking_enabled?: boolean
          public_booking_max_days_advance?: number
          public_booking_min_hours_advance?: number
          public_booking_slug?: string | null
          reminder_enabled?: boolean
          reminder_last_run_at?: string | null
          reminder_offsets_hours?: number[]
          reminder_send_weekends?: boolean
          reminder_template_body?: string | null
          reminder_template_subject?: string | null
          reminder_window_end?: string
          reminder_window_start?: string
          tech_responsible_council?: string | null
          tech_responsible_name?: string | null
          tech_responsible_registration?: string | null
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address_cep?: string | null
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_street?: string | null
          address_uf?: string | null
          cnpj?: string | null
          corporate_name?: string | null
          created_at?: string
          email?: string | null
          logo_path?: string | null
          logo_uploaded_at?: string | null
          phone?: string | null
          public_booking_cancel_min_hours?: number
          public_booking_enabled?: boolean
          public_booking_max_days_advance?: number
          public_booking_min_hours_advance?: number
          public_booking_slug?: string | null
          reminder_enabled?: boolean
          reminder_last_run_at?: string | null
          reminder_offsets_hours?: number[]
          reminder_send_weekends?: boolean
          reminder_template_body?: string | null
          reminder_template_subject?: string | null
          reminder_window_end?: string
          reminder_window_start?: string
          tech_responsible_council?: string | null
          tech_responsible_name?: string | null
          tech_responsible_registration?: string | null
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_clinic_profile_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
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
      tenant_integrations: {
        Row: {
          config: Json
          connected_at: string
          created_at: string
          created_by_user_id: string | null
          credentials_enc: string
          enabled: boolean
          location_id: string | null
          provider: string
          status: string
          tenant_id: string
          updated_at: string
          webhook_secret_enc: string | null
        }
        Insert: {
          config: Json
          connected_at?: string
          created_at?: string
          created_by_user_id?: string | null
          credentials_enc: string
          enabled?: boolean
          location_id?: string | null
          provider: string
          status?: string
          tenant_id: string
          updated_at?: string
          webhook_secret_enc?: string | null
        }
        Update: {
          config?: Json
          connected_at?: string
          created_at?: string
          created_by_user_id?: string | null
          credentials_enc?: string
          enabled?: boolean
          location_id?: string | null
          provider?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          webhook_secret_enc?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
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
      treatment_plan_steps: {
        Row: {
          appointment_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doctor_id: string | null
          id: string
          notes: string | null
          patient_id: string
          plan_id: string | null
          procedure_id: string
          scheduled_date: string | null
          status: string
          tenant_id: string
          title: string
        }
        Insert: {
          appointment_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doctor_id?: string | null
          id?: string
          notes?: string | null
          patient_id: string
          plan_id?: string | null
          procedure_id: string
          scheduled_date?: string | null
          status?: string
          tenant_id: string
          title: string
        }
        Update: {
          appointment_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doctor_id?: string | null
          id?: string
          notes?: string | null
          patient_id?: string
          plan_id?: string | null
          procedure_id?: string
          scheduled_date?: string | null
          status?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plan_steps_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_steps_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_steps_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_steps_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
          },
          {
            foreignKeyName: "treatment_plan_steps_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_steps_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "health_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_steps_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          manufacturer: string | null
          source_catalog_version_id: string
          terminology_chapter: string | null
          tuss_table: string
          tuss_table_label: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          id?: string
          manufacturer?: string | null
          source_catalog_version_id: string
          terminology_chapter?: string | null
          tuss_table?: string
          tuss_table_label?: string | null
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          manufacturer?: string | null
          source_catalog_version_id?: string
          terminology_chapter?: string | null
          tuss_table?: string
          tuss_table_label?: string | null
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
      user_active_tenant: {
        Row: {
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_tenant_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profile: {
        Row: {
          avatar_path: string | null
          avatar_uploaded_at: string | null
          created_at: string
          full_name: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_path?: string | null
          avatar_uploaded_at?: string | null
          created_at?: string
          full_name?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_path?: string | null
          avatar_uploaded_at?: string | null
          created_at?: string
          full_name?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_tenants: {
        Row: {
          created_at: string
          disabled_at: string | null
          disabled_by: string | null
          role: string
          status: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          disabled_by?: string | null
          role: string
          status?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          disabled_by?: string | null
          role?: string
          status?: string
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
      vital_signs: {
        Row: {
          appointment_id: string | null
          bmi: number | null
          created_at: string
          diastolic_bp: number | null
          heart_rate: number | null
          height_cm: number | null
          id: string
          measured_at: string
          measured_by: string
          notes: string | null
          oxygen_saturation: number | null
          patient_id: string
          respiratory_rate: number | null
          systolic_bp: number | null
          temperature_celsius: number | null
          tenant_id: string
          weight_grams: number | null
        }
        Insert: {
          appointment_id?: string | null
          bmi?: number | null
          created_at?: string
          diastolic_bp?: number | null
          heart_rate?: number | null
          height_cm?: number | null
          id?: string
          measured_at?: string
          measured_by: string
          notes?: string | null
          oxygen_saturation?: number | null
          patient_id: string
          respiratory_rate?: number | null
          systolic_bp?: number | null
          temperature_celsius?: number | null
          tenant_id: string
          weight_grams?: number | null
        }
        Update: {
          appointment_id?: string | null
          bmi?: number | null
          created_at?: string
          diastolic_bp?: number | null
          heart_rate?: number | null
          height_cm?: number | null
          id?: string
          measured_at?: string
          measured_by?: string
          notes?: string | null
          oxygen_saturation?: number | null
          patient_id?: string
          respiratory_rate?: number | null
          systolic_bp?: number | null
          temperature_celsius?: number | null
          tenant_id?: string
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vital_signs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_tenant_id_fkey"
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
          appointment_ends_at: string | null
          cancellation_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          completion_id: string | null
          confirmation_id: string | null
          confirmed_at: string | null
          created_at: string | null
          doctor_id: string | null
          duration_minutes: number | null
          effective_status: string | null
          frozen_amount_cents: number | null
          frozen_commission_bps: number | null
          id: string | null
          net_amount_cents: number | null
          net_commission_cents: number | null
          observacoes: string | null
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
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
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
            foreignKeyName: "doctor_commission_history_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
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
      doctor_payment_terms_current: {
        Row: {
          billing_day: number | null
          created_at: string | null
          doctor_id: string | null
          liberal_default_cents: number | null
          monthly_amount_cents: number | null
          payment_mode: Database["public"]["Enums"]["payment_mode"] | null
          percentage_bps: number | null
          tenant_id: string | null
          valid_from: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_payment_terms_history_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctor_payment_terms_history_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "monthly_fixed_pay_lines"
            referencedColumns: ["doctor_id"]
          },
          {
            foreignKeyName: "doctor_payment_terms_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_fixed_pay_lines: {
        Row: {
          amount_cents: number | null
          billing_date: string | null
          billing_day: number | null
          doctor_id: string | null
          doctor_name: string | null
          month_start: string | null
          tenant_id: string | null
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
      attach_assistant_to_appointment: {
        Args: {
          p_actor: string
          p_amount_cents: number
          p_appointment_id: string
          p_assistant_doctor_id: string
        }
        Returns: string
      }
      attach_materials_to_appointment: {
        Args: { p_actor: string; p_appointment_id: string; p_materials: Json }
        Returns: Json
      }
      auth_hook_custom_claims: { Args: { event: Json }; Returns: Json }
      cancel_appointment: {
        Args: {
          p_appointment_id: string
          p_by: string
          p_notes?: string
          p_reason: string
        }
        Returns: string
      }
      close_monthly_payout: {
        Args: { p_month: string; p_tenant_id: string }
        Returns: Json
      }
      confirm_appointment: {
        Args: { p_appointment_id: string; p_by: string; p_notes?: string }
        Returns: string
      }
      create_appointment_with_materials: {
        Args: {
          p_actor: string
          p_appointment_at: string
          p_doctor_id: string
          p_duration_minutes: number
          p_frozen_amount_cents: number
          p_frozen_commission_bps: number
          p_materials: Json
          p_observacoes: string
          p_patient_id: string
          p_plan_id: string
          p_procedure_id: string
          p_source: string
          p_source_commission_history_id: string
          p_source_price_version_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      create_appointment_with_procedures_and_materials: {
        Args: {
          p_actor: string
          p_appointment_at: string
          p_doctor_id: string
          p_duration_minutes: number
          p_frozen_commission_bps: number
          p_materials: Json
          p_observacoes: string
          p_patient_id: string
          p_procedures: Json
          p_source: string
          p_source_commission_history_id: string
          p_source_raw_event_id?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      create_first_tenant: {
        Args: {
          p_cnpj?: string
          p_name: string
          p_phone?: string
          p_slug: string
          p_user_id: string
        }
        Returns: string
      }
      create_price_version: {
        Args: {
          p_actor_id: string
          p_amount_cents: number
          p_expected_head_id: string
          p_plan_id: string
          p_procedure_id: string
          p_reason: string
          p_tenant_id: string
          p_valid_from: string
        }
        Returns: Json
      }
      create_step_with_appointment: {
        Args: {
          p_amount_cents: number
          p_appointment_at: string
          p_commission_bps: number
          p_commission_history_id: string
          p_created_by: string
          p_doctor_id: string
          p_duration_minutes: number
          p_notes: string
          p_patient_id: string
          p_plan_id: string
          p_price_version_id: string
          p_procedure_id: string
          p_tenant_id: string
          p_title: string
        }
        Returns: {
          appointment_id: string
          step_id: string
        }[]
      }
      dec_text: { Args: { cipher: string }; Returns: string }
      dec_text_with_key: {
        Args: { cipher: string; key: string }
        Returns: string
      }
      decrypt_patient_names_for_ids: {
        Args: { p_key: string; p_patient_ids: string[]; p_tenant_id: string }
        Returns: {
          anonymized_at: string
          full_name: string
          id: string
        }[]
      }
      enc_text: { Args: { plain: string }; Returns: string }
      enc_text_with_key: {
        Args: { key: string; plain: string }
        Returns: string
      }
      generate_user_notifications: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: Json
      }
      get_patient_for_tenant: {
        Args: { p_key: string; p_patient_id: string; p_tenant_id: string }
        Returns: {
          address_cep: string
          address_city: string
          address_complement: string
          address_neighborhood: string
          address_number: string
          address_state: string
          address_street: string
          anonymized_at: string
          birth_date: string
          cpf: string
          created_at: string
          email: string
          emergency_contact_name: string
          emergency_contact_phone: string
          full_name: string
          ghl_contact_id: string
          guardian_cpf: string
          guardian_name: string
          guardian_relationship: string
          id: string
          insurance_card_number: string
          mother_name: string
          phone: string
          rg: string
          sex: string
          social_name: string
          updated_at: string
        }[]
      }
      is_last_active_admin: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: boolean
      }
      jwt_role: { Args: never; Returns: string }
      jwt_tenant_id: { Args: never; Returns: string }
      list_patients_for_tenant: {
        Args: { p_key: string; p_tenant_id: string }
        Returns: {
          address_cep: string
          address_city: string
          address_complement: string
          address_neighborhood: string
          address_number: string
          address_state: string
          address_street: string
          anonymized_at: string
          birth_date: string
          cpf: string
          created_at: string
          email: string
          full_name: string
          ghl_contact_id: string
          id: string
          phone: string
          updated_at: string
        }[]
      }
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
      mark_appointment_realized: {
        Args: { p_appointment_id: string; p_by: string; p_reason?: string }
        Returns: string
      }
      patient_enc_key: { Args: never; Returns: string }
      public_booking_find_patient_by_cpf: {
        Args: { p_cpf: string; p_key: string; p_tenant_id: string }
        Returns: {
          email: string
          full_name: string
          patient_id: string
          phone: string
        }[]
      }
      public_booking_resolve_slug: {
        Args: { p_slug: string }
        Returns: {
          address_line: string
          cancel_min_hours: number
          display_name: string
          logo_path: string
          max_days_advance: number
          min_hours_advance: number
          phone: string
          tenant_id: string
        }[]
      }
      public_booking_slots: {
        Args: {
          p_doctor_id: string
          p_from: string
          p_procedure_id: string
          p_slug: string
          p_to: string
        }
        Returns: {
          slot_end: string
          slot_start: string
        }[]
      }
      record_payment_terms_change: {
        Args: {
          p_actor: string
          p_billing_day: number
          p_doctor_id: string
          p_liberal_default_cents: number
          p_monthly_amount_cents: number
          p_payment_mode: Database["public"]["Enums"]["payment_mode"]
          p_percentage_bps: number
          p_reason: string
          p_tenant_id: string
          p_valid_from: string
        }
        Returns: string
      }
      remove_appointment_assistant: {
        Args: { p_actor: string; p_id: string }
        Returns: undefined
      }
      reopen_monthly_payout: {
        Args: { p_month: string; p_reason: string; p_tenant_id: string }
        Returns: Json
      }
      session_text: { Args: { key: string }; Returns: string }
      session_uuid: { Args: { key: string }; Returns: string }
      tenant_cash_balance_at: {
        Args: { p_date: string; p_tenant_id: string }
        Returns: number
      }
      test_truncate_all_mutable: {
        Args: { wipe_catalog?: boolean }
        Returns: undefined
      }
    }
    Enums: {
      payment_mode: "comissionado" | "fixo" | "liberal"
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
    Enums: {
      payment_mode: ["comissionado", "fixo", "liberal"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

