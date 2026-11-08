import { authMutationKeys, parseAdditionalFieldValue } from "@better-auth-ui/core";
import { useAuth, useFetchOptions, useSignUpEmail } from "@better-auth-ui/react";
import { useIsMutating } from "@tanstack/react-query";
import { type SyntheticEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldDescription, FieldGroup, FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { checkSignupEmail, signupEmailDenialMessage } from "@/lib/email-domain-policy";
import { cn } from "@/lib/utils";
import { ProviderButtons, type SocialLayout } from "./provider-buttons";
import { SignUpFormFields } from "./sign-up-form-fields";

export type SignUpProps = {
  className?: string;
  socialLayout?: SocialLayout;
  socialPosition?: "top" | "bottom";
};

/**
 * Renders a sign-up form with name, email, and password fields, optional social provider buttons, and submission handling.
 *
 * Submits credentials to the configured auth client and handles the response:
 * - If email verification is required, shows a notification and navigates to sign-in
 * - On success, refreshes the session and navigates to the configured redirect path
 * - On failure, displays error toasts
 * - Manages a pending state while the request is in-flight
 *
 * @param className - Additional CSS classes applied to the outer container
 * @param socialLayout - Social layout to apply to the component
 * @param socialPosition - Social position to apply to the component
 * @returns The sign-up form React element.
 */
export function SignUp({ className, socialLayout, socialPosition = "bottom" }: SignUpProps) {
  const {
    additionalFields,
    authClient,
    basePaths,
    emailAndPassword,
    localization,
    plugins,
    redirectTo,
    socialProviders,
    viewPaths,
    navigate,
    Link,
  } = useAuth();

  const { fetchOptions, resetFetchOptions } = useFetchOptions();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { mutate: signUpEmail, isPending: signUpEmailPending } = useSignUpEmail(authClient, {
    onError: () => {
      setPassword("");
      setConfirmPassword("");
      resetFetchOptions();
    },
    onSuccess: (_data, { email }) => {
      if (emailAndPassword?.requireEmailVerification) {
        sessionStorage.setItem("better-auth-ui.verify-email", email);
        navigate({
          to: `${basePaths.auth}/${viewPaths.auth.verifyEmail}`,
        });
      } else {
        navigate({ to: redirectTo });
      }
    },
  });

  const signInMutating = useIsMutating({
    mutationKey: authMutationKeys.signIn.all,
  });
  const signUpMutating = useIsMutating({
    mutationKey: authMutationKeys.signUp.all,
  });
  const isPending = signInMutating + signUpMutating > 0;

  const Captcha = plugins.find((plugin) => plugin.captchaComponent)?.captchaComponent;

  const [passwordVisibility, setPasswordVisibility] = useState({
    password: false,
    confirm: false,
  });

  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    // `emailAndPassword.name === false` hides the name field and submits "".
    const name = (formData.get("name") as string | null) ?? "";
    const email = formData.get("email") as string;

    if (emailAndPassword?.confirmPassword && password !== confirmPassword) {
      toast.error(localization.auth.passwordsDoNotMatch);
      setPassword("");
      setConfirmPassword("");
      return;
    }

    const emailPolicy = checkSignupEmail(email);
    // Operator domains (ADMIN_EMAIL_DOMAINS) and verified team domains are known
    // only to the server, so it alone rejects a domain as not allowed.
    if (!emailPolicy.ok && emailPolicy.reason !== "not_allowed") {
      toast.error(signupEmailDenialMessage(emailPolicy.reason));
      setFieldErrors((current) => ({
        ...current,
        email: signupEmailDenialMessage(emailPolicy.reason),
      }));
      return;
    }

    const fieldsToValidate = (additionalFields ?? []).filter(
      (field) => Boolean(field.signUp) && !field.readOnly,
    );

    const validations = await Promise.all(
      fieldsToValidate.map(async (field) => {
        const value = parseAdditionalFieldValue(field, formData.get(field.name) as string | null);

        if (field.validate) {
          try {
            await field.validate(value);
          } catch (error) {
            return {
              error: error instanceof Error ? error.message : String(error),
              value: undefined as unknown,
              name: field.name,
            };
          }
        }

        return { error: null as string | null, value, name: field.name };
      }),
    );

    const firstError = validations.find((result) => result.error);
    if (firstError?.error) {
      toast.error(firstError.error);
      return;
    }

    const additionalFieldValues: Record<string, unknown> = {};
    for (const result of validations) {
      if (result.value !== undefined) {
        additionalFieldValues[result.name] = result.value;
      }
    }

    signUpEmail({
      name,
      email,
      password,
      ...additionalFieldValues,
      fetchOptions,
    });
  };

  const showSeparator = emailAndPassword?.enabled && socialProviders && socialProviders.length > 0;

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{localization.auth.signUp}</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-6">
          {socialPosition === "top" && (
            <>
              {socialProviders && socialProviders.length > 0 && (
                <ProviderButtons socialLayout={socialLayout} />
              )}

              {showSeparator && (
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card text-xs flex items-center">
                  {localization.auth.or}
                </FieldSeparator>
              )}
            </>
          )}

          {emailAndPassword?.enabled && (
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <SignUpFormFields
                  localization={localization}
                  emailAndPassword={emailAndPassword}
                  additionalFields={additionalFields}
                  isPending={isPending}
                  password={password}
                  confirmPassword={confirmPassword}
                  passwordVisibility={passwordVisibility}
                  fieldErrors={fieldErrors}
                  onPasswordChange={setPassword}
                  onConfirmPasswordChange={setConfirmPassword}
                  onTogglePasswordVisible={() =>
                    setPasswordVisibility((prev) => ({ ...prev, password: !prev.password }))
                  }
                  onToggleConfirmPasswordVisible={() =>
                    setPasswordVisibility((prev) => ({ ...prev, confirm: !prev.confirm }))
                  }
                  onClearFieldError={(field) =>
                    setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
                  }
                  onSetFieldError={(field, message) =>
                    setFieldErrors((prev) => ({ ...prev, [field]: message }))
                  }
                />

                {Captcha && <div className="flex justify-center">{Captcha}</div>}

                <div className="flex flex-col gap-3">
                  <Button type="submit" disabled={isPending}>
                    {signUpEmailPending && <Spinner />}

                    {localization.auth.signUp}
                  </Button>

                  {plugins.flatMap((plugin) =>
                    (plugin.authButtons ?? []).map((AuthButton, index) => (
                      <AuthButton key={`${plugin.id}-${index.toString()}`} view="signUp" />
                    )),
                  )}
                </div>
              </FieldGroup>
            </form>
          )}

          {socialPosition === "bottom" && (
            <>
              {showSeparator && (
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card text-xs flex items-center">
                  {localization.auth.or}
                </FieldSeparator>
              )}

              {socialProviders && socialProviders.length > 0 && (
                <ProviderButtons socialLayout={socialLayout} />
              )}
            </>
          )}
        </div>

        {emailAndPassword?.enabled && (
          <div className="flex flex-col gap-3 items-center w-full mt-4">
            <FieldDescription className="text-center">
              {localization.auth.alreadyHaveAnAccount}{" "}
              <Link
                href={`${basePaths.auth}/${viewPaths.auth.signIn}`}
                className="underline underline-offset-4"
              >
                {localization.auth.signIn}
              </Link>
            </FieldDescription>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
