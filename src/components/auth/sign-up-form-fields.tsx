import type { AdditionalField as AdditionalFieldType } from "@better-auth-ui/core";
import { Eye, EyeOff } from "lucide-react";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { AdditionalField } from "./additional-field";

type Localization = {
  auth: {
    name: string;
    namePlaceholder: string;
    email: string;
    emailPlaceholder: string;
    password: string;
    passwordPlaceholder: string;
    confirmPassword: string;
    confirmPasswordPlaceholder: string;
    fieldRequired: string;
    invalidEmail: string;
    tooShort: string;
    tooLong: string;
    hidePassword: string;
    showPassword: string;
  };
};

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
};

export function SignUpFormFields({
  localization,
  emailAndPassword,
  additionalFields,
  isPending,
  password,
  confirmPassword,
  passwordVisibility,
  fieldErrors,
  onPasswordChange,
  onConfirmPasswordChange,
  onTogglePasswordVisible,
  onToggleConfirmPasswordVisible,
  onClearFieldError,
  onSetFieldError,
}: {
  localization: Localization;
  emailAndPassword: {
    name?: boolean;
    confirmPassword?: boolean;
    minPasswordLength?: number;
    maxPasswordLength?: number;
  };
  additionalFields?: AdditionalFieldType[];
  isPending: boolean;
  password: string;
  confirmPassword: string;
  passwordVisibility: { password: boolean; confirm: boolean };
  fieldErrors: FieldErrors;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onTogglePasswordVisible: () => void;
  onToggleConfirmPasswordVisible: () => void;
  onClearFieldError: (field: keyof FieldErrors) => void;
  onSetFieldError: (field: keyof FieldErrors, message: string) => void;
}) {
  const min = emailAndPassword.minPasswordLength;
  const max = emailAndPassword.maxPasswordLength;
  const isPasswordVisible = passwordVisibility.password;
  const isConfirmPasswordVisible = passwordVisibility.confirm;

  return (
    <>
      {emailAndPassword.name !== false && (
        <Field data-invalid={!!fieldErrors.name}>
          <Label htmlFor="name">{localization.auth.name}</Label>

          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder={localization.auth.namePlaceholder}
            required
            disabled={isPending}
            onChange={() => onClearFieldError("name")}
            onInvalid={(e) => {
              e.preventDefault();
              onSetFieldError("name", localization.auth.fieldRequired);
            }}
            aria-invalid={!!fieldErrors.name}
          />

          <FieldError>{fieldErrors.name}</FieldError>
        </Field>
      )}

      <Field data-invalid={!!fieldErrors.email}>
        <Label htmlFor="email">{localization.auth.email}</Label>

        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={localization.auth.emailPlaceholder}
          required
          disabled={isPending}
          onChange={() => onClearFieldError("email")}
          onInvalid={(e) => {
            e.preventDefault();
            const el = e.target as HTMLInputElement;
            const msg = el.validity.valueMissing
              ? localization.auth.fieldRequired
              : localization.auth.invalidEmail;
            onSetFieldError("email", msg);
          }}
          aria-invalid={!!fieldErrors.email}
        />

        <FieldError>{fieldErrors.email}</FieldError>
      </Field>

      {additionalFields?.map(
        (field) =>
          field.signUp === "above" && (
            <AdditionalField
              key={field.name}
              name={field.name}
              field={field}
              isPending={isPending}
            />
          ),
      )}

      <Field data-invalid={!!fieldErrors.password}>
        <Label htmlFor="password">{localization.auth.password}</Label>

        <InputGroup>
          <InputGroupInput
            id="password"
            name="password"
            type={isPasswordVisible ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              onPasswordChange(e.target.value);
              onClearFieldError("password");
            }}
            placeholder={localization.auth.passwordPlaceholder}
            required
            minLength={min}
            maxLength={max}
            disabled={isPending}
            onInvalid={(e) => {
              e.preventDefault();
              const el = e.target as HTMLInputElement;
              const msg = el.validity.valueMissing
                ? localization.auth.fieldRequired
                : el.validity.tooShort
                  ? localization.auth.tooShort.replace("{{min}}", String(min))
                  : localization.auth.tooLong.replace("{{max}}", String(max));
              onSetFieldError("password", msg);
            }}
            aria-invalid={!!fieldErrors.password}
          />

          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={
                isPasswordVisible ? localization.auth.hidePassword : localization.auth.showPassword
              }
              title={
                isPasswordVisible ? localization.auth.hidePassword : localization.auth.showPassword
              }
              onClick={onTogglePasswordVisible}
            >
              {isPasswordVisible ? <EyeOff /> : <Eye />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        <FieldError>{fieldErrors.password}</FieldError>
      </Field>

      {emailAndPassword.confirmPassword && (
        <Field data-invalid={!!fieldErrors.confirmPassword}>
          <Label htmlFor="confirmPassword">{localization.auth.confirmPassword}</Label>

          <InputGroup>
            <InputGroupInput
              id="confirmPassword"
              name="confirmPassword"
              type={isConfirmPasswordVisible ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                onConfirmPasswordChange(e.target.value);
                onClearFieldError("confirmPassword");
              }}
              placeholder={localization.auth.confirmPasswordPlaceholder}
              required
              minLength={min}
              maxLength={max}
              disabled={isPending}
              onInvalid={(e) => {
                e.preventDefault();
                const el = e.target as HTMLInputElement;
                const msg = el.validity.valueMissing
                  ? localization.auth.fieldRequired
                  : el.validity.tooShort
                    ? localization.auth.tooShort.replace("{{min}}", String(min))
                    : localization.auth.tooLong.replace("{{max}}", String(max));
                onSetFieldError("confirmPassword", msg);
              }}
              aria-invalid={!!fieldErrors.confirmPassword}
            />

            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={
                  isConfirmPasswordVisible
                    ? localization.auth.hidePassword
                    : localization.auth.showPassword
                }
                title={
                  isConfirmPasswordVisible
                    ? localization.auth.hidePassword
                    : localization.auth.showPassword
                }
                onClick={onToggleConfirmPasswordVisible}
              >
                {isConfirmPasswordVisible ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>

          <FieldError>{fieldErrors.confirmPassword}</FieldError>
        </Field>
      )}

      {additionalFields?.map(
        (field) =>
          field.signUp &&
          field.signUp !== "above" && (
            <AdditionalField
              key={field.name}
              name={field.name}
              field={field}
              isPending={isPending}
            />
          ),
      )}
    </>
  );
}
