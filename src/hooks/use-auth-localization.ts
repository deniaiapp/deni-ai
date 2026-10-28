import { useExtracted } from "use-intl";

/**
 * better-auth-ui fills templates with `.replace("{{token}}", value)`.
 * next-intl uses ICU `{token}`, so we pass the better-auth token as the ICU value.
 */
const ba = {
  provider: "{{provider}}",
  max: "{{max}}",
  min: "{{min}}",
  seconds: "{{seconds}}",
  name: "{{name}}",
} as const;

/**
 * Builds Better Auth UI localization from next-intl translations.
 */
export function useAuthLocalization() {
  const t = useExtracted();

  return {
    auth: {
      account: t("Account"),
      alreadyHaveAnAccount: t("Already have an account?"),
      alreadyVerifiedYourEmail: t("Already verified your email?"),
      confirmPassword: t("Confirm password"),
      confirmPasswordPlaceholder: t("Confirm your password"),
      checkYourEmail: t("Check your email for a verification link"),
      continueWith: t("Continue with {provider}", { provider: ba.provider }),
      email: t("Email"),
      emailPlaceholder: t("m@example.com"),
      fieldRequired: t("This field is required"),
      forgotPassword: t("Forgot Password"),
      forgotPasswordLink: t("Forgot password?"),
      hidePassword: t("Hide password"),
      invalidEmail: t("Please enter a valid email address"),
      invalidResetPasswordToken: t("Invalid reset password token"),
      name: t("Name"),
      namePlaceholder: t("Name"),
      needToCreateAnAccount: t("Need to create an account?"),
      newPassword: t("New password"),
      newPasswordPlaceholder: t("New password"),
      openEmailProvider: t("Open {provider}", { provider: ba.provider }),
      or: t("OR"),
      password: t("Password"),
      passwordPlaceholder: t("Password"),
      passwordResetEmailSent: t("Password reset email sent"),
      passwordResetSuccess: t("Password reset successfully"),
      passwordsDoNotMatch: t("Passwords do not match"),
      rememberMe: t("Remember me"),
      tooLong: t("Must be at most {max} characters", { max: ba.max }),
      tooShort: t("Must be at least {min} characters", { min: ba.min }),
      rememberYourPassword: t("Remember your password?"),
      resend: t("Resend"),
      resendIn: t("Resend in {seconds}s", { seconds: ba.seconds }),
      resetPassword: t("Reset Password"),
      sendResetLink: t("Send reset link"),
      showPassword: t("Show password"),
      signIn: t("Sign In"),
      signOut: t("Sign Out"),
      signUp: t("Sign Up"),
      verificationEmailSent: t("Verification email sent!"),
      verifyEmail: t("Verify Email"),
    },
    settings: {
      account: t("Account"),
      accountUnlinked: t("Account unlinked"),
      active: t("Active"),
      activeSessions: t("Active sessions"),
      avatar: t("Avatar"),
      currentSession: t("Current session"),
      avatarChangedSuccess: t("Avatar changed successfully"),
      avatarDeletedSuccess: t("Avatar deleted successfully"),
      changeAvatar: t("Change avatar"),
      deleteAvatar: t("Delete avatar"),
      link: t("Link"),
      linkedAccounts: t("Linked accounts"),
      linkProvider: t("Link your {provider} account", { provider: ba.provider }),
      cancel: t("Cancel"),
      copyToClipboard: t("Copy to clipboard"),
      changeEmail: t("Change email"),
      changeEmailSuccess: t("Check your email to confirm the change"),
      changePassword: t("Change password"),
      changePasswordSuccess: t("Password changed successfully"),
      currentPassword: t("Current password"),
      currentPasswordPlaceholder: t("Enter your current password"),
      dangerZone: t("Danger zone"),
      delete: t("Delete"),
      optional: t("Optional"),
      profileUpdatedSuccess: t("Profile updated successfully"),
      revoke: t("Revoke"),
      revokeSession: t("Revoke session"),
      revokeSessionSuccess: t("Session revoked successfully"),
      saveChanges: t("Save changes"),
      setPassword: t("Set password"),
      setPasswordDescription: t(
        "You don't have a password yet. Request a reset link to set one up.",
      ),
      security: t("Security"),
      settings: t("Settings"),
      time: t("Time"),
      unlinkProvider: t("Unlink {provider}", { provider: ba.provider }),
      updateEmail: t("Update email"),
      updatePassword: t("Update password"),
      uploadAvatar: t("Upload avatar"),
      userProfile: t("User profile"),
    },
    plugins: {
      passkey: {
        passkey: t("Passkey"),
        addPasskey: t("Add passkey"),
        deletePasskey: t("Delete passkey {name}", { name: ba.name }),
        deletePasskeyTitle: t("Delete passkey"),
        deletePasskeyWarning: t(
          "This action cannot be undone. You will need to add this passkey again before you can use it to sign in.",
        ),
        passkeys: t("Passkeys"),
        passkeysDescription: t("Create a passkey to securely access your account."),
        noPasskeys: t("No passkeys"),
        name: t("Name"),
      },
      magicLink: {
        magicLink: t("Magic Link"),
        sendMagicLink: t("Send Magic Link"),
        magicLinkSent: t("Check your email for the magic link"),
      },
      deleteUser: {
        deleteAccount: t("Delete account"),
        deleteAccountDescription: t(
          "Permanently remove your account and all associated data. This cannot be undone.",
        ),
        deleteUserVerificationSent: t("Check your email to confirm account deletion."),
        deleteUserSuccess: t("Your account has been deleted."),
      },
    },
  };
}
