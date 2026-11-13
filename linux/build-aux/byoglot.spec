%{!?byoglot_version:%global byoglot_version 0.3.11}

Name:           byoglot
Version:        %{byoglot_version}
Release:        1%{?dist}
Summary:        Translate text with your own AI providers
License:        MIT
URL:            https://github.com/BrainRTP/byoglot-translator
Source0:        %{name}-%{version}.tar.gz
BuildRequires:  cargo >= 1.95
BuildRequires:  rust >= 1.95
BuildRequires:  gcc
BuildRequires:  pkgconfig(gtk4) >= 4.10
BuildRequires:  pkgconfig(libadwaita-1) >= 1.5
BuildRequires:  desktop-file-utils
BuildRequires:  appstream

%description
Translate text using your own provider connections, models and instruction templates.
API keys use the desktop Secret Service when available. No history is saved.

%prep
%autosetup

%build
cargo build --manifest-path linux/Cargo.toml --release --frozen -p byoglot

%install
install -Dm755 linux/target/release/byoglot %{buildroot}%{_bindir}/byoglot
install -Dm644 linux/data/io.github.brainrtp.ByoGlot.desktop %{buildroot}%{_datadir}/applications/io.github.brainrtp.ByoGlot.desktop
install -Dm644 linux/data/io.github.brainrtp.ByoGlot.metainfo.xml %{buildroot}%{_datadir}/metainfo/io.github.brainrtp.ByoGlot.metainfo.xml
install -Dm644 linux/data/icons/hicolor/scalable/apps/io.github.brainrtp.ByoGlot.svg %{buildroot}%{_datadir}/icons/hicolor/scalable/apps/io.github.brainrtp.ByoGlot.svg

%check
desktop-file-validate %{buildroot}%{_datadir}/applications/io.github.brainrtp.ByoGlot.desktop
appstreamcli validate --no-net %{buildroot}%{_datadir}/metainfo/io.github.brainrtp.ByoGlot.metainfo.xml

%files
%license LICENSE
%{_bindir}/byoglot
%{_datadir}/applications/io.github.brainrtp.ByoGlot.desktop
%{_datadir}/metainfo/io.github.brainrtp.ByoGlot.metainfo.xml
%{_datadir}/icons/hicolor/scalable/apps/io.github.brainrtp.ByoGlot.svg
