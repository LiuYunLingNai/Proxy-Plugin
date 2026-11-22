param([ValidateSet('read','write')][string]$Action, [string]$Payload = 'e30=')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ProxyPluginWinInet {
  [StructLayout(LayoutKind.Explicit)] struct Value { [FieldOffset(0)] public uint number; [FieldOffset(0)] public IntPtr text; }
  [StructLayout(LayoutKind.Sequential)] struct Option { public uint id; public Value value; }
  [StructLayout(LayoutKind.Sequential)] struct List { public uint size; public IntPtr connection; public uint count; public uint error; public IntPtr options; }
  [DllImport("wininet.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool InternetQueryOptionW(IntPtr handle, uint option, ref List list, ref uint length);
  [DllImport("wininet.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool InternetSetOptionW(IntPtr handle, uint option, ref List list, uint length);
  [DllImport("wininet.dll", SetLastError=true)] static extern bool InternetSetOptionW(IntPtr handle, uint option, IntPtr buffer, uint length);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr pointer);
  public class Settings { public uint flags; public string server; public string bypass; public string pac; }
  public static Settings Read() {
    int width=Marshal.SizeOf(typeof(Option)); IntPtr buffer=Marshal.AllocHGlobal(width*4);
    try {
      for(int i=0;i<4;i++) Marshal.StructureToPtr(new Option { id=(uint)(i+1) }, IntPtr.Add(buffer,width*i),false);
      List list=new List { size=(uint)Marshal.SizeOf(typeof(List)), count=4, options=buffer }; uint size=list.size;
      if(!InternetQueryOptionW(IntPtr.Zero,75,ref list,ref size)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      Settings settings=new Settings();
      for(int i=0;i<4;i++) {
        Option entry=(Option)Marshal.PtrToStructure(IntPtr.Add(buffer,width*i),typeof(Option));
        if(i==0) settings.flags=entry.value.number;
        else { string text=Marshal.PtrToStringUni(entry.value.text) ?? ""; if(i==1) settings.server=text; if(i==2) settings.bypass=text; if(i==3) settings.pac=text; if(entry.value.text!=IntPtr.Zero) GlobalFree(entry.value.text); }
      }
      return settings;
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  public static void Write(uint flags,string server,string bypass,string pac) {
    int width=Marshal.SizeOf(typeof(Option)); IntPtr buffer=Marshal.AllocHGlobal(width*4);
    IntPtr[] strings={Marshal.StringToHGlobalUni(server ?? ""),Marshal.StringToHGlobalUni(bypass ?? ""),Marshal.StringToHGlobalUni(pac ?? "")};
    try {
      Marshal.StructureToPtr(new Option { id=1,value=new Value { number=flags } },buffer,false);
      for(int i=1;i<4;i++) Marshal.StructureToPtr(new Option { id=(uint)(i+1),value=new Value { text=strings[i-1] } },IntPtr.Add(buffer,width*i),false);
      List list=new List { size=(uint)Marshal.SizeOf(typeof(List)),count=4,options=buffer };
      if(!InternetSetOptionW(IntPtr.Zero,75,ref list,list.size)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      InternetSetOptionW(IntPtr.Zero,95,IntPtr.Zero,0); InternetSetOptionW(IntPtr.Zero,37,IntPtr.Zero,0);
    } finally { foreach(IntPtr text in strings) Marshal.FreeHGlobal(text); Marshal.FreeHGlobal(buffer); }
  }
}
'@
  if ($Action -eq 'write') {
    $value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
    [ProxyPluginWinInet]::Write([uint32]$value.flags, [string]$value.server, [string]$value.bypass, [string]$value.pac)
  }
  [ProxyPluginWinInet]::Read() | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
