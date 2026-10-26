using Avalonia.Controls;
using Avalonia.Platform.Storage;
using AllInOneInstaller.Configuration;
using AllInOneInstaller.Remote;

namespace AllInOneInstaller.App.Professional.Views;

/// <summary>Reads a key file and stores a private key in configuration/keys/&lt;server&gt;, for Settings and the login.</summary>
public static class SshKeyImport
{
    public sealed record Imported(string Path, AuthorizedKey Key);

    /// <summary>Asks for a key file (in ~/.ssh when it exists). Returns null when cancelled.</summary>
    /// <exception cref="IOException">The file is too large to be an SSH key.</exception>
    public static async Task<(string Name, string Text)?> PickFileAsync(TopLevel top, string title)
    {
        var options = new FilePickerOpenOptions { Title = title, AllowMultiple = false };
        string sshFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".ssh");
        if (Directory.Exists(sshFolder)) options.SuggestedStartLocation = await top.StorageProvider.TryGetFolderFromPathAsync(sshFolder);
        IReadOnlyList<IStorageFile> files = await top.StorageProvider.OpenFilePickerAsync(options);
        if (files.Count == 0) return null;
        await using Stream stream = await files[0].OpenReadAsync();
        if (stream.CanSeek && stream.Length > 64 * 1024) throw new IOException($"{files[0].Name} is too large to be an SSH key.");
        using var reader = new StreamReader(stream);
        return (files[0].Name, await reader.ReadToEndAsync());
    }

    /// <summary>
    /// Stores a private key as it is (still protected by its password) with its public key next to it. The password
    /// is asked once to read the public key. Returns null when that question is cancelled.
    /// </summary>
    /// <exception cref="FormatException">Not a usable private key.</exception>
    public static async Task<Imported?> ImportPrivateKeyAsync(Window owner, string text, string source, string folder)
    {
        string passphrase = "";
        while (true)
        {
            try
            {
                AuthorizedKey key = SshKeys.PublicKeyOf(text, passphrase, $"imported {source}");
                return new Imported(ClientConfiguration.SaveImportedKey(folder, text, key), key);
            }
            catch (SshKeys.KeyPasswordException ex)
            {
                string? entered = await PasswordDialog.ShowAsync(owner, "Key password", "This key has a password",
                    passphrase.Length > 0 ? ex.Message + " Try again." : "Enter it once to read the public key. The key is stored as it is: still protected by its password.",
                    confirm: false);
                if (entered is null) return null;
                passphrase = entered;
            }
        }
    }
}
